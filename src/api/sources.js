import { send } from "../lib/http.js";
import { readSources, writeSources } from "../lib/yamlStore.js";
import { journal } from "../lib/journal.js";
import { can } from "../../shared/model.js";
import { readJson, updateJson } from "../lib/store.js";
import { query } from "../lib/db.js";
import { enqueue, attendreJob } from "../lib/demandes.js";
import { reliabilityOf } from "../../shared/sourceReliability.js";

/* État de récolte tenu par le moteur (src/ingest/harvestRun.js de M3) : même clé
   kv et même délai de revérification du furtif, recopiés ici pour ne pas
   importer le moteur (T21c). */
/* Écrit par la récolte du moteur, lu et retouché ici : clé du contrat (T26). */
export { KV_ETAT_SOURCES as SOURCES_STATE_KEY } from "../../shared/contrat.js";
import { KV_ETAT_SOURCES as SOURCES_STATE_KEY } from "../../shared/contrat.js";
export const FURTIF_RECHECK_MS = 7 * 86400000;

/* Test d'une source, communes, restauration du référentiel : demandes au
   moteur (T21, src/jobs/taches/ de M3), attendues ici ≤ 45 s (attendreJob).
   Une demande close en erreur rend son message ; le statut HTTP en est déduit. */
async function demander(kind, params, user) {
  const job = await enqueue(kind, params, user);
  return attendreJob(job.id);
}
export const statutDErreur = (erreur) =>
  /déjà en cours/.test(erreur) ? 409 : /introuvable/.test(erreur) ? 404 : 502;

function guard(role, res) {
  if (!can(role, "manage_sources")) {
    send(res, 403, { error: "réservé à l'administrateur" });
    return false;
  }
  return true;
}

/* Fiabilité par source (shared/sourceReliability.js) : rendement des récoltes
   + sort éditorial des articles générés. Une erreur ici ne doit pas priver le
   back-office de sa liste : on renvoie alors un objet vide. */
async function reliabilityById(sources) {
  try {
    const states = (await readJson(SOURCES_STATE_KEY, {})) || {};
    const counts = {};
    const { rows } = await query("SELECT source_id, status, count(*)::int AS n FROM articles WHERE source_id IS NOT NULL GROUP BY 1, 2");
    for (const r of rows) (counts[r.source_id] ||= {})[r.status] = r.n;
    const out = {};
    for (const s of sources) {
      if (!s.active && !states[s.id]) continue;
      const y = states[s.id]?.yield;
      const st = states[s.id];
      const dernier = y?.recent?.length ? y.recent.at(-1) : null;
      /* `etat` : l'état de planification brut (shared/sourceSchedule.js) + le
         dernier passage (shared/sourceReliability.js), pour l'écran Sources. */
      const etat = {
        lastAttemptAt: st?.lastAttemptAt || null,
        lastOkAt: st?.lastOkAt || null,
        failures: st?.failures || 0,
        quarantinedUntil: st?.quarantinedUntil || null,
        dernier: dernier ? { at: dernier.at, ok: !!dernier.ok, n: dernier.n || 0 } : null,
      };
      out[s.id] = { ...reliabilityOf(y, counts[s.id] || {}), articles: counts[s.id] || {}, lastItemAt: y?.lastItemAt || null, emptyStreak: y?.emptyStreak || 0, etat };
    }
    return out;
  } catch {
    return {};
  }
}

export async function list({ res }) {
  const sources = await readSources();
  const by = (k) => sources.filter((s) => s.kind === k);
  send(res, 200, {
    sources,
    reliability: await reliabilityById(sources),
    stats: {
      total: sources.length,
      active: sources.filter((s) => s.active).length,
      public: { total: by("public").length, active: by("public").filter((s) => s.active).length },
      private: { total: by("private").length, active: by("private").filter((s) => s.active).length },
    },
  });
}

export async function replace({ res, body, role }) {
  if (!guard(role, res)) return;
  if (!Array.isArray(body.sources)) return send(res, 400, { error: "corps attendu : { sources: [...] }" });
  const saved = await writeSources(body.sources, { author: role });
  journal("action", "sources enregistrées", { detail: { total: saved.length, actives: saved.filter((s) => s.active).length } });
  send(res, 200, { ok: true, sources: saved });
}

/* Pré-remplissage de la zone des sources (M3-78) : communes saisies → département.
   Le gazetteer ne vit que côté serveur (150 Ko) ; le navigateur envoie les noms,
   reçoit les correspondances, et propose — l'administrateur relit avant
   d'enregistrer. Rien n'est écrit ici. */
export async function communes({ res, body, role, user }) {
  if (!guard(role, res)) return;
  const names = Array.isArray(body?.names) ? body.names.slice(0, 2000).map(String) : null;
  if (!names) return send(res, 400, { error: "corps attendu : { names: [...] }" });
  const job = await demander("resolve_communes", { names }, user);
  if (job.error) return send(res, statutDErreur(job.error), { error: job.error });
  send(res, 200, { communes: job.result?.communes || {} });
}

/* Les baselines sont figées dans l'image du moteur : il restaure et journalise.
   Voie chaîne : derrière une génération, l'attente dépasse 45 s et la route
   rend 504 (la restauration se fera, visible dans les dernières demandes). */
export async function restoreBaseline({ res, role, user }) {
  if (!guard(role, res)) return;
  const job = await demander("restore_sources", {}, user);
  if (job.error) return send(res, 500, { error: job.error });
  send(res, 200, { ok: true, total: job.result?.total ?? 0, active: job.result?.active ?? 0 });
}

/* ---------- M3-117 : liste blanche du furtif et sources mises à l'écart ----------
   Lecture de l'état de récolte (harvest/sources-state.json, tenu par
   src/ingest/harvestRun.js) et retrait manuel d'une source de la liste blanche.
   Administrateur seulement : la lecture comme l'écriture passent par guard(). */

const dernierPassage = (st) => {
  const d = st?.yield?.recent?.length ? st.yield.recent.at(-1) : null;
  return d ? { at: d.at, ok: !!d.ok, n: d.n || 0 } : null;
};

/* État brut → deux listes pour le back-office. Une source disparue du
   référentiel garde sa ligne (nom = id) : son état existe encore et pèse sur la
   récolte si elle revient. */
export function listeBlancheFurtif(states, sources, maintenant = Date.now()) {
  const noms = new Map((sources || []).map((s) => [s.id, s.name || s.id]));
  const furtif = [];
  const ecart = [];
  for (const [id, st] of Object.entries(states || {})) {
    if (!st || typeof st !== "object") continue;
    const base = { id, name: noms.get(id) || id, connue: noms.has(id), failures: st.failures || 0, lastOkAt: st.lastOkAt || null, dernier: dernierPassage(st) };
    if (st.furtif?.since) {
      const ref = Date.parse(st.furtif.checkedAt || st.furtif.since);
      furtif.push({ ...base, since: st.furtif.since, checkedAt: st.furtif.checkedAt || null,
        prochainRetest: Number.isNaN(ref) ? null : new Date(ref + FURTIF_RECHECK_MS).toISOString() });
    }
    if (st.quarantinedUntil && Date.parse(st.quarantinedUntil) > maintenant) {
      ecart.push({ ...base, quarantinedUntil: st.quarantinedUntil, enFurtif: !!st.furtif?.since });
    }
  }
  furtif.sort((a, b) => a.since.localeCompare(b.since));
  ecart.sort((a, b) => a.quarantinedUntil.localeCompare(b.quarantinedUntil));
  return { furtif, ecart };
}

export async function lireListeBlanche({ lire = readJson, sources = readSources, maintenant = Date.now() } = {}) {
  const states = (await lire(SOURCES_STATE_KEY, {})) || {};
  return listeBlancheFurtif(states, await sources(), maintenant);
}

/* Retrait sous verrou de ligne (updateJson) : seul le champ `furtif` de cette
   source change ; le reste de l'état, écrit en même temps par une récolte, est
   relu sous le verrou et conservé. → true si la source était en liste blanche. */
export async function retirerDeListeBlanche(id, { maj = updateJson } = {}) {
  let retiree = false;
  await maj(SOURCES_STATE_KEY, (all) => {
    const st = all?.[id];
    if (!st?.furtif) return all || {};
    retiree = true;
    const { furtif: _retire, ...reste } = st;
    return { ...all, [id]: reste };
  }, {});
  return retiree;
}

export async function furtif({ res, role }) {
  if (!guard(role, res)) return;
  send(res, 200, await lireListeBlanche());
}

export async function retirerFurtif({ res, role, params }) {
  if (!guard(role, res)) return;
  const id = String(params?.[0] || "");
  if (!id) return send(res, 400, { error: "source attendue" });
  if (!(await retirerDeListeBlanche(id))) return send(res, 404, { error: "source absente de la liste blanche du furtif" });
  journal("action", "source retirée de la liste blanche du furtif", { target: id });
  send(res, 200, { ok: true, ...(await lireListeBlanche()) });
}

/* Test d'une source (M3-110, T21) : lecture seule et bornée, dans le moteur
   (src/ingest/testSource.js de M3). Un second test de la même source pendant le
   premier : 409. */
export async function test({ res, params, user }) {
  const sources = await readSources();
  const s = sources.find((x) => x.id === params[0]);
  if (!s) return send(res, 404, { error: "source introuvable" });
  const job = await demander("test_source", { sourceId: s.id }, user);
  if (job.error) return send(res, statutDErreur(job.error), { ok: false, erreur: job.error, error: job.error });
  send(res, 200, job.result);
}
