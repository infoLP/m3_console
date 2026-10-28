/* /api/health (M3-108, axe T2) — santé du service, par niveau de détail.

   Deux lecteurs. Le HEALTHCHECK du conteneur, sans session : il ne regarde que
   le statut et le booléen `ok`. Depuis la séparation console/moteur (T25, à la
   M2), 200 veut dire « base joignable ET schéma au niveau » : une console
   déployée avant que le moteur ait joué ses migrations répond 503, et la liste
   des migrations à jouer est dans le rapport (connecté). Et la page d'erreur, qui sonde ici
   pour dire si le service est en cause et donner une référence à transmettre.

   Sans session, la réponse se borne à { ok, etat, ref, at } : l'état d'une base
   ou la liste de ses tables n'a pas à être lisible par n'importe qui. Connecté,
   on ajoute les mesures ; administrateur, la configuration, en oui/non ou en
   libellé, JAMAIS une valeur de variable d'environnement.

   Toutes les mesures sont faites à chaque appel, même sans session : l'état
   « dégradé » doit être le même pour tous, et c'est lui qui écrit la ligne de
   journal que la référence permet de retrouver. */

import { query } from "../lib/db.js";
import { log } from "../lib/log.js";
import { send } from "../lib/http.js";
import { authMode, localEnabled } from "../lib/oidc.js";
import { ATTENDUS, MIGRATION_MINIMALE, migrationsAJouer, calculerEtat, etatWorker, fabriquerRef, filtrerParNiveau, niveauDe } from "./sante.regles.js";

/* Les éléments attendus absents du schéma courant : une table par to_regclass,
   une colonne par information_schema (seulement si sa table existe, sinon
   c'est la table qui manque). Même requête que M2_Console/src/etat.ts. */
async function elementsAbsents() {
  const tables = ATTENDUS.filter((a) => !a.nom.includes(".")).map((a) => a.nom);
  const colonnes = ATTENDUS.filter((a) => a.nom.includes(".")).map((a) => a.nom);
  const { rows } = await query(
    `SELECT nom FROM unnest($1::text[]) AS nom WHERE to_regclass(nom) IS NULL
     UNION ALL
     SELECT c.nom FROM unnest($2::text[]) AS c(nom)
      WHERE to_regclass(split_part(c.nom, '.', 1)) IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = split_part(c.nom, '.', 1) AND column_name = split_part(c.nom, '.', 2))`,
    [tables, colonnes]
  );
  return rows.map((r) => r.nom);
}

/* La dernière migration inscrite par le moteur : null si aucune (ou table
   absente, base neuve), undefined si la lecture a échoué autrement. Les noms
   commencent par leur numéro sur trois chiffres : l'ordre texte est le bon. */
async function derniereMigration() {
  if ((await query("SELECT to_regclass('schema_migrations') AS t")).rows[0]?.t == null) return null;
  const { rows } = await query("SELECT max(version) AS v FROM schema_migrations");
  return rows[0]?.v ?? null;
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

  /* Le schéma d'abord : c'est lui qui dit quelles migrations jouer. Si on ne
     peut pas le lire, ni les tables ni les migrations ne sont vérifiées. */
  let tables = null;
  let migrations = null;
  try {
    const absents = await elementsAbsents();
    tables = ATTENDUS.map((a) => ({ nom: a.nom, ok: !absents.includes(a.nom) }));
    let derniere;
    try { derniere = await derniereMigration(); } catch (e) { erreurs.migrations = e?.message || String(e); }
    migrations = { minimale: MIGRATION_MINIMALE, derniere: derniere ?? null, aJouer: migrationsAJouer(absents, derniere) };
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
  const ok = etat === "ok";

  if (etat === "degrade") {
    /* La référence copiée par l'utilisateur mène à cette ligne : tout le détail
       est ici, à plat (log.js rend un objet plat en clé=valeur). */
    log.error("sante", "service dégradé", {
      ref,
      base: m.base.ok ? "ok" : "injoignable",
      latenceMs: m.base.latenceMs,
      migrations: m.migrations ? `dernière ${m.migrations.derniere ?? "aucune"}, minimale ${m.migrations.minimale}` : "non vérifiées",
      migrationsAJouer: m.migrations?.aJouer.join(",") || undefined,
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
