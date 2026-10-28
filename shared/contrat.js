/* Contrat console ↔ moteur (T17, lot 1 du découpage) : ce que les deux côtés
   doivent lire de la même façon, sans s'importer l'un l'autre. La base est le
   seul canal : la console DÉPOSE une demande dans `jobs` et lit le kv
   `moteur/etat` ; le moteur PREND les demandes et écrit ce kv.

   Module pur (aucun import) : il est copié tel quel dans m3_console au lot 5. */

/* Types de demande admis — miroir du CHECK `jobs_kind_check` (migration 023).
   En ajouter un : une migration, puis cette liste, puis src/jobs/taches/<kind>.js. */
export const JOB_KINDS = [
  "harvest", "generate", "test_models",
  "rescore", "competitor_scan", "restore_sources", "regenerate", "publish",
  "test_source", "test_wp_target", "test_llm", "fetch_models", "preview_prompt", "resolve_communes",
];

/* Quatre voies, quatre boucles dans le worker. La chaîne porte le long (une
   génération peut durer 20 min) ; l'interactive porte ce qu'un écran attend
   (≤ 30-45 s) ; la voie « articles » (R6, T19) porte la publication d'un
   article (≤ 2 min), qui n'attend ni derrière une génération ni ne retient
   l'interactive ; la voie « fond » (R9) porte le scan des concurrents, qui peut
   durer une heure et ne doit retenir ni la récolte ni la génération demandées
   depuis la console. Aucune n'est bloquée par une autre. La voie n'est pas en base :
   la changer ne demande pas de migration.

   regenerate reste dans la chaîne : les compteurs LLM et le moteur courant
   sont globaux au processus, une régénération en parallèle d'une génération
   fausserait ses comptes (isolation prévue en T32). */
export const VOIES = {
  chaine: ["harvest", "generate", "test_models", "rescore", "restore_sources", "regenerate"],
  articles: ["publish"],
  fond: ["competitor_scan"],
  interactive: ["test_source", "test_wp_target", "test_llm", "fetch_models", "preview_prompt", "resolve_communes"],
};

export function voieDe(kind) {
  if (VOIES.interactive.includes(kind)) return "interactive";
  if (VOIES.articles.includes(kind)) return "articles";
  if (VOIES.fond.includes(kind)) return "fond";
  return "chaine";
}

export const INTERVALLE_CHAINE_MS = 5000;
export const INTERVALLE_ARTICLES_MS = 2000;
/* Fond : pas de délai maximal, un scan borne lui-même ses appels. */
export const INTERVALLE_FOND_MS = 10_000;
export const INTERVALLE_INTERACTIVE_MS = 750;
/* Au-delà, la voie clôt la demande en échec et passe à la suivante (la tâche,
   elle, n'est pas interrompue : chacune borne ses propres appels). */
export const DELAI_MAX_ARTICLES_MS = 5 * 60_000;
export const DELAI_MAX_INTERACTIVE_MS = 60_000;
/* Ce qu'une route de la console attend une demande interactive avant de rendre la main. */
export const ATTENTE_INTERACTIVE_MS = 45_000;

/* Déduplication : deux demandes de même clé ne s'empilent pas tant que la
   première attend (index unique partiel, migration 023).
   - "kind"       une seule en attente par type, quels que soient les paramètres ;
   - [champs]     une par valeur de ces paramètres (test_models : par moteur) ;
   - "params"     une par jeu de paramètres identique (double clic). */
const DEDUP = {
  harvest: "kind", generate: "kind", rescore: "kind", competitor_scan: "kind", restore_sources: "kind",
  test_models: ["provider"], regenerate: ["articleId"], publish: ["articleId"],
};

/* JSON à clés triées : { a, b } et { b, a } donnent la même clé. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/* cyrb53 : empreinte courte et sans dépendance (pas de node:crypto, ce module
   tourne aussi dans le navigateur). Une collision ne ferait que fusionner
   deux demandes interactives : tolérable. */
function empreinte(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function cleDemande(kind, params = {}) {
  const regle = DEDUP[kind] ?? "params";
  if (regle === "kind") return kind;
  if (Array.isArray(regle)) return `${kind}:${regle.map((c) => String(params?.[c] ?? "")).join(":")}`;
  return `${kind}:${empreinte(stable(params || {}))}`;
}

/* Une ligne de `jobs` telle que les deux côtés la manipulent. */
export function ligneDemande(r) {
  if (!r) return null;
  return {
    id: Number(r.id), kind: r.kind, params: r.params || {},
    requestedBy: r.requested_by, requestedAt: r.requested_at,
    startedAt: r.started_at, finishedAt: r.finished_at,
    worker: r.worker, result: r.result, error: r.error,
  };
}

/* kv `moteur/etat`, écrit par le worker à chaque battement (5 s) :
   { at, worker, demarre, voies: { chaine|articles|fond|interactive: { occupee, demande } } }.
   Jamais de secret : identifiants de demande, types et horodatages seulement. */
export const KV_MOTEUR_ETAT = "moteur/etat";
export const MOTEUR_PERIME_MS = 30_000;

/* Clé de l'icône du site dans `settings` (data URL, hors SETTING_SPECS) :
   écrite par la console, servie par les deux côtés. */
export const SITE_ICON_KEY = "site_icon";

/* Clés kv que la console lit directement (R7, T24) : l'état de planification,
   écrit par l'ordonnanceur du moteur, et le registre des dépenses LLM. */
export const KV_PLANIFICATION = "schedule/state.json";
export const KV_DEPENSES_LLM = "llm/spend.json";

/* Autres clés kv et seuil que la console lit sans importer le moteur (T26) :
   - KV_ETAT_SOURCES : état de récolte par source (furtif, quarantaine), écrit
     par harvestRun, lu et retouché par l'écran Sources ;
   - KV_VERROU_SCAN : bail « competitors » du scan des concurrents
     (src/lib/runLock.js écrit locks/<nom>.json), lu pour dire « scan en cours » ;
   - KV_PLANIF_CONCURRENTS : dernier créneau du scan planifié ;
   - SOURCE_LISIBLE_MIN : signes de texte source en dessous desquels finalize
     saute les contrôles de citations et de lieux, et la console dit « source
     mince » dans les preuves. */
export const KV_ETAT_SOURCES = "harvest/sources-state.json";
export const KV_VERROU_SCAN = "locks/competitors.json";
export const KV_PLANIF_CONCURRENTS = "schedule/competitors.json";
export const SOURCE_LISIBLE_MIN = 200;

/* Clés des consignes que rend la relecture (src/llm/prompts/review.js,
   CLES_CONSIGNES), dans son ordre : le panneau Preuves de la console les
   affiche. Chaque côté vérifie sa liste contre celle-ci. */
export const CLES_CONSIGNES_RELECTURE = Object.freeze([
  "style_phrases_creuses", "chapo_factuel", "fin_concrete", "angle",
  "communique_non_explique", "date_redigee", "partenaire_signale",
]);

/* « 2026-10-12 » et « 2026-10 », à l'heure de Paris : les tranches du registre
   des dépenses (KV_DEPENSES_LLM). fr-CA formate déjà en AAAA-MM-JJ, ce qui
   évite de recomposer les parties à la main. Déplacé de src/llm/budget.js (R7). */
const PARIS = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

export function periodKeys(now = Date.now()) {
  const day = PARIS.format(new Date(now));
  return { day, month: day.slice(0, 7) };
}

export function moteurVivant(etat, now = Date.now()) {
  const t = Date.parse(etat?.at ?? "");
  return Number.isFinite(t) && now - t <= MOTEUR_PERIME_MS;
}
