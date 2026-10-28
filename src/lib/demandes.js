/* Demandes au moteur, côté console (T17, lot 1 du découpage).

   La console ne fait plus rien tourner du moteur : elle DÉPOSE une ligne dans
   `jobs`, la RELIT, et lit le kv `moteur/etat`. Rien ici n'importe le moteur
   (test/frontiere.test.js) : le contrat est la table, ses types et ses clés de
   déduplication sont dans shared/contrat.js. Même SQL que src/jobs/queue.js.

   - appel long (régénération, publication, récolte) : enqueue, réponse 202 avec
     l'id, le navigateur suit la demande (composants/SuiviDemande) ;
   - appel court (test d'une source, d'une cible, d'un moteur) : enqueue puis
     attendreJob, côté serveur, ≤ 45 s. */

import { query } from "./db.js";
import { readJson } from "./store.js";
import {
  JOB_KINDS, cleDemande, ligneDemande, KV_MOTEUR_ETAT, ATTENTE_INTERACTIVE_MS, moteurVivant,
} from "../../shared/contrat.js";

/* Dépose une demande, ou rend celle de même clé qui attend déjà (`duplicate`). */
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
    if (rows.length) return { ...ligneDemande(rows[0]), duplicate: false };
    const pending = await query(
      "SELECT * FROM jobs WHERE dedup_key = $1 AND started_at IS NULL ORDER BY requested_at, id LIMIT 1",
      [cle]
    );
    if (pending.rows.length) return { ...ligneDemande(pending.rows[0]), duplicate: true };
  }
  throw Object.assign(new Error("file des demandes encombrée, réessayer"), { status: 503 });
}

export async function getJob(id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const { rows } = await query("SELECT * FROM jobs WHERE id = $1", [n]);
  return ligneDemande(rows[0]);
}

/* Pour l'onglet Dernier run et le sondage du front après un clic. */
export async function lastJobs(limit = 10) {
  const { rows } = await query(
    "SELECT * FROM jobs ORDER BY requested_at DESC, id DESC LIMIT $1",
    [Math.min(Math.max(1, Number(limit) || 10), 100)]
  );
  return rows.map(ligneDemande);
}

/* { …kv moteur/etat, vivant } ; `vivant` faux si le worker n'a pas battu depuis 30 s. */
export async function lireEtatMoteur(now = Date.now()) {
  const etat = await readJson(KV_MOTEUR_ETAT, null);
  return { ...(etat || {}), vivant: moteurVivant(etat, now) };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* Attend la fin d'une demande, côté serveur. Rend la demande close (résultat ou
   erreur dans `result` / `error`) ; au-delà du délai, 504 avec la cause la plus
   probable : moteur arrêté, ou simplement trop lent. */
export async function attendreJob(id, { delaiMs = ATTENTE_INTERACTIVE_MS, pasMs = 500, now = Date.now } = {}) {
  const fin = now() + delaiMs;
  for (;;) {
    const job = await getJob(id);
    if (!job) throw Object.assign(new Error(`demande ${id} introuvable`), { status: 404 });
    if (job.finishedAt) return job;
    if (now() >= fin) break;
    await pause(Math.min(pasMs, Math.max(0, fin - now())));
  }
  const { vivant } = await lireEtatMoteur(now()).catch(() => ({ vivant: false }));
  throw Object.assign(
    new Error(vivant
      ? `le moteur n'a pas fini la demande ${id} en ${Math.round(delaiMs / 1000)} s ; elle continue, résultat dans les dernières demandes`
      : "le moteur ne répond pas (worker arrêté ?) : la demande attendra son redémarrage"),
    { status: 504 }
  );
}
