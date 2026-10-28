/* File des demandes d'exécution (table `jobs`, migration 014).

   Le serveur web DÉPOSE (enqueue), le worker PREND (claimNext) et CLÔT (finish).
   Pourquoi une table et pas LISTEN/NOTIFY : un sondage toutes les cinq secondes
   est invisible pour un bouton de back-office, et une table garde l'historique —
   qui a demandé quoi, quand, avec quel résultat — là où une notification ne
   laisse rien. Pas de verrou consultatif non plus : `FOR UPDATE SKIP LOCKED`
   suffit pour que deux workers ne prennent jamais la même ligne, même si un
   seul tourne aujourd'hui.

   Le bail « chain » (src/lib/runLock.js) reste la garde contre deux runs
   simultanées : la file ordonne les demandes, le bail protège l'exécution,
   y compris face à la chaîne planifiée qui ne passe pas par ici. */

import { hostname } from "node:os";
import { query } from "../lib/db.js";
import { JOB_KINDS, cleDemande, ligneDemande as row } from "../../shared/contrat.js";

export { JOB_KINDS };
export const JOB_RETENTION_DAYS = 30;
export const WORKER_NAME = `${hostname()}#${process.pid}`;

/* Dépose une demande. Si une demande de même clé attend déjà (shared/contrat.js,
   cleDemande : par type pour une récolte, par moteur pour le test des modèles,
   par jeu de paramètres pour une demande interactive), on la rend
   (`duplicate: true`) au lieu d'en empiler une seconde : deux clics impatients
   ne doivent pas valoir deux récoltes. Une demande en cours, elle, n'empêche
   pas d'en déposer une autre — elle passera après.

   L'index unique partiel de la migration 023 tranche les clics simultanés :
   l'INSERT perdant ne rend rien, on relit alors la gagnante. Si elle vient
   d'être prise entre-temps, on retente l'INSERT une fois.

   Même SQL que src/lib/demandes.js côté console : le contrat est la table. */
export async function enqueue(kind, params = {}, user = null) {
  if (!JOB_KINDS.includes(kind)) {
    throw Object.assign(new Error(`demande inconnue : ${kind}`), { status: 400 });
  }
  const cle = cleDemande(kind, params);
  for (let essai = 0; essai < 2; essai++) {
    const { rows } = await query(
      `INSERT INTO jobs (kind, params, requested_by, dedup_key) VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (dedup_key) WHERE started_at IS NULL AND dedup_key IS NOT NULL DO NOTHING
         RETURNING *`,
      [kind, JSON.stringify(params || {}), user?.login || null, cle]
    );
    if (rows.length) return { ...row(rows[0]), duplicate: false };
    const pending = await query(
      "SELECT * FROM jobs WHERE dedup_key = $1 AND started_at IS NULL ORDER BY requested_at, id LIMIT 1",
      [cle]
    );
    if (pending.rows.length) return { ...row(pending.rows[0]), duplicate: true };
  }
  throw Object.assign(new Error("file des demandes encombrée, réessayer"), { status: 503 });
}

/* Prend la plus ancienne demande en attente parmi `kinds` (toutes si null), ou
   null. Atomique : la sous-requête verrouille la ligne, SKIP LOCKED ignore
   celles qu'un autre processus — ou l'autre voie — tient. */
export async function claimNext(kinds = null, worker = WORKER_NAME) {
  const { rows } = await query(
    `UPDATE jobs SET started_at = now(), worker = $1
      WHERE id = (SELECT id FROM jobs WHERE started_at IS NULL AND ($2::text[] IS NULL OR kind = ANY($2::text[]))
                   ORDER BY requested_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [worker, kinds]
  );
  return row(rows[0]);
}

export async function finish(id, { result = null, error = null } = {}) {
  await query(
    "UPDATE jobs SET finished_at = now(), result = $2::jsonb, error = $3 WHERE id = $1",
    [id, result == null ? null : JSON.stringify(result), error]
  );
}

/* Au démarrage du worker : une demande « en cours » ne peut pas l'être, puisque
   le seul worker vient de démarrer — le précédent a été tué en pleine run. On la
   clôt en échec plutôt que de la laisser « en cours » pour toujours à l'écran.
   Le bail « chain » qu'elle tenait est libéré par le worker juste après. */
export async function reclaimInterrupted() {
  const { rowCount } = await query(
    `UPDATE jobs SET finished_at = now(), error = 'interrompue : le worker a redémarré avant la fin'
      WHERE started_at IS NOT NULL AND finished_at IS NULL`
  );
  return rowCount;
}

/* Pour l'onglet Dernier run et le sondage du front après un clic. */
export async function lastJobs(limit = 10) {
  const { rows } = await query(
    "SELECT * FROM jobs ORDER BY requested_at DESC, id DESC LIMIT $1",
    [Math.min(Math.max(1, Number(limit) || 10), 100)]
  );
  return rows.map(row);
}

export async function pruneJobs(days = JOB_RETENTION_DAYS) {
  const { rowCount } = await query(
    "DELETE FROM jobs WHERE finished_at IS NOT NULL AND finished_at < now() - make_interval(days => $1)",
    [days]
  );
  return rowCount;
}
