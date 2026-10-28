/* /api/health (M3-108, axe T2) — santé du service, par niveau de détail.

   Deux lecteurs. Le HEALTHCHECK du conteneur, sans session : il ne regarde que
   le statut (200 si la base répond, 503 sinon) et le booléen `ok` — ce contrat
   date de auth.health et ne doit pas bouger. Et la page d'erreur, qui sonde ici
   pour dire si le service est en cause et donner une référence à transmettre.

   Sans session, la réponse se borne à { ok, etat, ref, at } : l'état d'une base
   ou la liste de ses tables n'a pas à être lisible par n'importe qui. Connecté,
   on ajoute les mesures ; administrateur, la configuration, en oui/non ou en
   libellé, JAMAIS une valeur de variable d'environnement.

   Toutes les mesures sont faites à chaque appel, même sans session : l'état
   « dégradé » doit être le même pour tous, et c'est lui qui écrit la ligne de
   journal que la référence permet de retrouver. */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { query } from "../lib/db.js";
import { log } from "../lib/log.js";
import { send } from "../lib/http.js";
import { ROOT } from "../lib/racine.js";
import { authMode, localEnabled } from "../lib/oidc.js";
import { TABLES_ATTENDUES, calculerEtat, etatWorker, fabriquerRef, filtrerParNiveau, niveauDe } from "./sante.regles.js";

/* Même filtre que src/tools/migrate.js : la 007 est un .mjs, et elle est
   inscrite dans schema_migrations comme les .sql. Ne compter que les .sql la
   ferait passer pour une migration inconnue. */
async function migrationsAttendues() {
  return (await readdir(join(ROOT, "migrations"))).filter((f) => f.endsWith(".sql") || f.endsWith(".mjs")).sort();
}

/* Chaque mesure est isolée : une table de suivi illisible ne doit pas masquer
   que la base, elle, répond. Une mesure ratée vaut null, et compte comme un
   manque (cf. calculerEtat). Les messages d'erreur ne partent que vers le
   journal, jamais dans la réponse. */
async function mesurer() {
  const erreurs = {};
  const depart = performance.now();
  try {
    await query("SELECT 1");
  } catch (e) {
    return { base: { ok: false, latenceMs: null }, migrations: null, tables: null, worker: "inconnu", erreurs: { base: e?.message || String(e) } };
  }
  const base = { ok: true, latenceMs: Math.round(performance.now() - depart) };

  let migrations = null;
  try {
    const [{ rows }, attendues] = await Promise.all([query("SELECT version FROM schema_migrations"), migrationsAttendues()]);
    const faites = new Set(rows.map((r) => r.version));
    migrations = { appliquees: attendues.filter((f) => faites.has(f)).length, attendues: attendues.length, manquantes: attendues.filter((f) => !faites.has(f)) };
  } catch (e) { erreurs.migrations = e?.message || String(e); }

  let tables = null;
  try {
    const { rows } = await query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)",
      [TABLES_ATTENDUES]
    );
    const presentes = new Set(rows.map((r) => r.table_name));
    tables = TABLES_ATTENDUES.map((nom) => ({ nom, ok: presentes.has(nom) }));
  } catch (e) { erreurs.tables = e?.message || String(e); }

  let worker = "inconnu";
  try {
    const { rows } = await query(
      `SELECT min(requested_at) FILTER (WHERE started_at IS NULL) AS attente,
              max(finished_at) AS traite FROM jobs`
    );
    worker = etatWorker({ plusAncienneAttente: rows[0]?.attente, dernierTraitement: rows[0]?.traite });
  } catch (e) { erreurs.worker = e?.message || String(e); }

  return { base, migrations, tables, worker, erreurs };
}

/* L'état EFFECTIF, celui du formulaire de connexion : pas le booléen de la
   stack, que le verrou localEnabled() peut contredire (faux sans Entra
   configuré rouvre le mot de passe). */
const libelleMotDePasse = () =>
  !localEnabled() ? "non" : authMode() === "entra" ? "oui (verrou : Entra non configuré)" : "oui";

export async function sante({ res, user, role }) {
  const ref = fabriquerRef();
  const at = new Date().toISOString();
  /* Rien ne doit sortir d'ici en exception : le HEALTHCHECK veut une réponse,
     et une page d'erreur qui sonde ne doit pas tomber à son tour. */
  let m;
  try { m = await mesurer(); } catch (e) {
    m = { base: { ok: false, latenceMs: null }, migrations: null, tables: null, worker: "inconnu", erreurs: { mesure: e?.message || String(e) } };
  }
  const etat = calculerEtat(m);
  const ok = m.base.ok;

  if (etat === "degrade") {
    /* La référence copiée par l'utilisateur mène à cette ligne : tout le détail
       est ici, à plat (log.js rend un objet plat en clé=valeur). */
    log.error("sante", "service dégradé", {
      ref,
      base: m.base.ok ? "ok" : "injoignable",
      latenceMs: m.base.latenceMs,
      migrations: m.migrations ? `${m.migrations.appliquees}/${m.migrations.attendues}` : "non vérifiées",
      migrationsManquantes: m.migrations?.manquantes.join(",") || undefined,
      tablesAbsentes: m.tables ? m.tables.filter((t) => !t.ok).map((t) => t.nom).join(",") || undefined : "non vérifiées",
      worker: m.worker,
      ...Object.fromEntries(Object.entries(m.erreurs || {}).map(([k, v]) => [`erreur_${k}`, v])),
    });
  }

  const rapport = {
    ok, etat, ref, at,
    base: m.base,
    migrations: m.migrations,
    tables: m.tables,
    config: {
      baseConfiguree: !!process.env.DATABASE_URL,
      planificateurCoupe: process.env.M3_SCHEDULER === "off",
      connexionMotDePasse: libelleMotDePasse(),
      worker: m.worker,
    },
  };
  send(res, ok ? 200 : 503, filtrerParNiveau(rapport, niveauDe(user, role)));
}
