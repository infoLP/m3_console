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

/* Deux voies, deux boucles dans le worker. La chaîne porte le long (une
   génération peut durer 20 min) ; l'interactive porte ce qu'un écran attend
   (≤ 30-45 s) et n'est jamais bloquée par la chaîne. La voie n'est pas en base :
   la changer ne demande pas de migration. */
export const VOIES = {
  chaine: ["harvest", "generate", "test_models", "rescore", "competitor_scan", "restore_sources", "regenerate", "publish"],
  interactive: ["test_source", "test_wp_target", "test_llm", "fetch_models", "preview_prompt", "resolve_communes"],
};

export function voieDe(kind) {
  return VOIES.interactive.includes(kind) ? "interactive" : "chaine";
}

export const INTERVALLE_CHAINE_MS = 5000;
export const INTERVALLE_INTERACTIVE_MS = 750;
/* Au-delà, la voie interactive clôt la demande en échec et passe à la suivante. */
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
   { at, worker, demarre, voies: { chaine|interactive: { occupee, demande } } }.
   Jamais de secret : identifiants de demande, types et horodatages seulement. */
export const KV_MOTEUR_ETAT = "moteur/etat";
export const MOTEUR_PERIME_MS = 30_000;

/* Clé de l'icône du site dans `settings` (data URL, hors SETTING_SPECS) :
   écrite par la console, servie par les deux côtés. */
export const SITE_ICON_KEY = "site_icon";

export function moteurVivant(etat, now = Date.now()) {
  const t = Date.parse(etat?.at ?? "");
  return Number.isFinite(t) && now - t <= MOTEUR_PERIME_MS;
}
