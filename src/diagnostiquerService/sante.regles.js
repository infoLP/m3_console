/* Santé du service (M3-108, axe T2) — règles pures, sans aucun import.

   Partagées par le gestionnaire serveur (sante.js) et par la sonde des pages
   d'erreur (SondeErreur.tsx) : ce fichier part donc aussi dans le navigateur,
   d'où l'absence de toute dépendance Node. Tout ce qui se décide ici se teste
   sans base (diagnostiquerService.test.ts). */

/* Schéma attendu, à la M2 (M2_Console/src/etat.ts) : les migrations vivent
   dans le moteur, qui les joue à son démarrage ; la console n'en a plus aucune
   copie à lire (T25). Elle dit seulement ce dont ELLE a besoin, table ou
   « table.colonne », et quelle migration du moteur le crée : un élément absent
   se traduit en « migration à jouer », que l'exploitant lit dans /api/health.

   Les migrations sans trace dans le schéma (données : 007, 018 ; contraintes)
   sont couvertes par MIGRATION_MINIMALE : la plus récente que cette console
   suppose jouée. À relever quand la console se met à dépendre d'une migration
   plus récente du moteur. */
export const MIGRATION_MINIMALE = "023_jobs_voies.sql";

export const ATTENDUS = [
  ...["kv_documents", "sources", "settings", "users", "config_history", "articles"].map((nom) => ({ nom, migration: "001_init.sql" })),
  { nom: "sessions", migration: "002_auth.sql" },
  { nom: "users.password_hash", migration: "002_auth.sql" },
  { nom: "articles.decided_at", migration: "003_decision_trace.sql" },
  { nom: "llm_providers", migration: "006_llm_providers.sql" },
  { nom: "auth_requests", migration: "008_entra.sql" },
  { nom: "users.entra_oid", migration: "008_entra.sql" },
  { nom: "sources.organisation", migration: "009_source_organisation.sql" },
  { nom: "sources.interval_days", migration: "010_source_interval.sql" },
  { nom: "sources.scope_level", migration: "011_source_zone.sql" },
  { nom: "journal", migration: "013_journal.sql" },
  { nom: "jobs", migration: "014_jobs.sql" },
  { nom: "llm_providers.model_tests", migration: "015_model_tests.sql" },
  ...["ip_failures", "ip_bans"].map((nom) => ({ nom, migration: "016_ip_bans.sql" })),
  { nom: "llm_prompts", migration: "017_llm_prompts.sql" },
  { nom: "wp_targets", migration: "019_wp_targets.sql" },
  { nom: "competitors", migration: "020_competitors.sql" },
  { nom: "competitor_candidates", migration: "021_competitor_candidates.sql" },
  { nom: "competitors.last_scan_at", migration: "021_competitor_candidates.sql" },
  { nom: "article_tombstones", migration: "022_article_tombstones.sql" },
  { nom: "articles.item_key", migration: "022_article_tombstones.sql" },
  { nom: "jobs.dedup_key", migration: "023_jobs_voies.sql" },
];

const numero = (migration) => Number.parseInt(String(migration ?? ""), 10);

/* Les migrations à jouer, sans doublon et dans l'ordre : celles des éléments
   absents, et la minimale si la dernière inscrite dans schema_migrations est
   plus ancienne (ou si rien n'y est inscrit : null). `derniere` vaut
   undefined quand on n'a pas pu la lire : on ne réclame alors que ce que le
   schéma montre. */
export function migrationsAJouer(manquants, derniere) {
  const a = new Set(ATTENDUS.filter((x) => manquants.includes(x.nom)).map((x) => x.migration));
  if (derniere !== undefined && !(numero(derniere) >= numero(MIGRATION_MINIMALE))) a.add(MIGRATION_MINIMALE);
  return [...a].sort();
}

export const INTERVALLE_SONDE_MS = 5_000;

/* Le worker sonde la file toutes les cinq secondes : une demande qui attend
   depuis cinq minutes veut dire qu'il ne tourne plus. Une demande traitée dans
   les dernières 24 h suffit à le dire actif — les demandes sont rares (un clic
   du back-office), une fenêtre plus courte le dirait « inconnu » presque
   toujours. */
export const ATTENTE_WORKER_MS = 5 * 60_000;
export const RECENCE_WORKER_MS = 24 * 3_600_000;

export const ROLE_ADMINISTRATEUR = "administrateur";

/* Sans 0/O ni 1/I/L : la référence se dicte au téléphone et se recopie à la
   main depuis une capture d'écran. */
const ALPHABET_REF = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const deux = (n) => String(n).padStart(2, "0");

/* « S-20261015-143205-K7QM » : l'horodatage (UTC, comme le journal) situe la
   ligne de log à la seconde, le suffixe départage deux appels de la même
   seconde. Ce n'est pas un secret : Math.random suffit. */
export function fabriquerRef(date = new Date(), alea = Math.random) {
  const jour = `${date.getUTCFullYear()}${deux(date.getUTCMonth() + 1)}${deux(date.getUTCDate())}`;
  const heure = `${deux(date.getUTCHours())}${deux(date.getUTCMinutes())}${deux(date.getUTCSeconds())}`;
  let suffixe = "";
  for (let i = 0; i < 4; i++) suffixe += ALPHABET_REF[Math.floor(alea() * ALPHABET_REF.length) % ALPHABET_REF.length];
  return `S-${jour}-${heure}-${suffixe}`;
}

export const FORME_REF = /^S-\d{8}-\d{6}-[A-HJKMNP-Z2-9]{4}$/;

/* Dégradé dès que la base ne répond pas, qu'une migration est à jouer ou qu'un
   élément attendu du schéma est absent. Une mesure qu'on n'a pas pu faire
   (null) compte comme un manque : on ne déclare pas sain ce qu'on n'a pas
   vérifié. */
export function calculerEtat({ base, migrations, tables } = {}) {
  if (!base?.ok) return "degrade";
  if (!migrations || migrations.aJouer.length > 0) return "degrade";
  if (!Array.isArray(tables) || tables.some((t) => !t.ok)) return "degrade";
  return "ok";
}

/* Qui demande : sans session, rien que l'état ; connecté, les mesures ; seul
   l'administrateur voit la configuration. Le rôle est celui que le pont
   transmet (« Voir comme » compris) : un administrateur qui se regarde en
   relecteur voit ce que voit un relecteur. */
export function niveauDe(user, role) {
  if (!user) return "public";
  return role === ROLE_ADMINISTRATEUR ? "administrateur" : "connecte";
}

/* Le filtrage se fait par liste blanche : un champ ajouté au rapport complet
   ne part vers personne tant qu'on ne l'a pas rangé ici. */
export function filtrerParNiveau(rapport, niveau) {
  /** @type {{ ok: boolean, etat: string, ref: string, at: string, base?: any, migrations?: any, tables?: any, config?: any }} */
  const out = { ok: rapport.ok, etat: rapport.etat, ref: rapport.ref, at: rapport.at };
  if (niveau === "public") return out;
  out.base = rapport.base ?? { ok: false, latenceMs: null };
  out.migrations = rapport.migrations ?? null;
  out.tables = rapport.tables ?? null;
  if (niveau === "administrateur") out.config = rapport.config ?? null;
  return out;
}

/* Le worker n'est pas visible depuis le web : son battement est un fichier
   dans SON conteneur. On le déduit de la file `jobs`. */
export function etatWorker({ plusAncienneAttente, dernierTraitement } = {}, maintenant = Date.now()) {
  const t = (v) => (v == null ? null : new Date(v).getTime());
  const attente = t(plusAncienneAttente);
  if (attente != null && maintenant - attente > ATTENTE_WORKER_MS) return "en attente";
  const traite = t(dernierTraitement);
  if (traite != null && maintenant - traite <= RECENCE_WORKER_MS) return "actif";
  return "inconnu";
}

/* ------------------------------------------------- sonde des pages d'erreur */

/* État de la sonde : `vu` est ce que la dernière réponse disait (« aucune »
   avant la première), `dejaRelancee` dit si cette erreur a déjà eu sa relance
   « premier ok » (mémorisée hors du composant, qui est remonté à chaque
   nouvelle erreur). `sain` est le champ `ok` de /api/health, false si la sonde
   n'a pas abouti. */
export const SONDE_INITIALE = { vu: "aucune", dejaRelancee: false };

export function apresSonde(etat, sain) {
  if (!sain) return { etat: { ...etat, vu: "degrade" }, relancer: false };
  /* Retour à la normale après une panne vue : c'est très probablement elle qui
     a fait tomber la page, on relit. Une fois par retour, puisque `vu` passe à
     « ok ». */
  if (etat.vu === "degrade") return { etat: { vu: "ok", dejaRelancee: true }, relancer: true };
  /* Service sain dès la première sonde : l'erreur vient d'ailleurs. Une seule
     tentative, sinon une erreur qui se reproduit relancerait toutes les 5 s. */
  if (etat.vu === "aucune") return { etat: { vu: "ok", dejaRelancee: true }, relancer: !etat.dejaRelancee };
  return { etat, relancer: false };
}

/* Le texte affiché sous la carte. `reponse` est la dernière réponse de
   /api/health, null avant la première, false si la sonde n'a pas abouti. */
export function messageSonde(reponse, relance) {
  if (relance) return { ton: "info", texte: "Service rétabli, rechargement…" };
  if (reponse === null || reponse === undefined) return { ton: "info", texte: "Vérification de l'état du service…" };
  if (reponse === false || !reponse.ok) return { ton: "avertissement", texte: `Service dégradé, nouvelle vérification dans ${INTERVALLE_SONDE_MS / 1000} s` };
  if (reponse.etat === "degrade") return { ton: "avertissement", texte: "Service partiellement dégradé : la base répond, mais l'installation est incomplète." };
  return { ton: "info", texte: "Le service répond normalement : l'erreur vient de cette page. Réessayez, ou transmettez la référence." };
}

const ouiNon = (v) => (v ? "oui" : "non");

/* Le détail technique, ligne par ligne, pour la zone réservée aux connectés.
   Rien si la réponse n'en porte pas (sans session, elle n'a pas `base`). */
export function lignesDetail(reponse) {
  if (!reponse || !reponse.base) return [];
  const l = [];
  const b = reponse.base;
  l.push(b.ok ? `Base : joignable (${b.latenceMs ?? "?"} ms)` : "Base : injoignable");
  const m = reponse.migrations;
  if (m) {
    l.push(m.aJouer.length
      ? `Migrations du moteur à jouer : ${m.aJouer.join(", ")}`
      : `Migrations : à jour (dernière ${m.derniere ?? "?"}, minimale ${m.minimale})`);
  } else if (b.ok) l.push("Migrations : non vérifiées");
  const t = reponse.tables;
  if (Array.isArray(t)) {
    const absentes = t.filter((x) => !x.ok).map((x) => x.nom);
    l.push(absentes.length ? `Schéma, éléments absents : ${absentes.join(", ")}` : `Schéma : les ${t.length} éléments attendus sont présents`);
  } else if (b.ok) l.push("Schéma : non vérifié");
  const c = reponse.config;
  if (c) {
    l.push(`Base configurée : ${ouiNon(c.baseConfiguree)}`);
    l.push(`Planificateur coupé : ${ouiNon(c.planificateurCoupe)}`);
    l.push(`Connexion par mot de passe : ${c.connexionMotDePasse}`);
    l.push(`Worker : ${c.worker}`);
  }
  return l;
}
