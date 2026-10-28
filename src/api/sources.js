import { send } from "../lib/http.js";
import { readSources, writeSources, restoreSourcesFromBaseline, readSettings } from "../lib/yamlStore.js";
import { resolveCommune } from "../generate/geo.js";
import { coveredOf } from "../../shared/zones.js";
import { journal } from "../lib/journal.js";
import { can } from "../../shared/model.js";
import { harvestFeed } from "../ingest/fetchFeed.js";
import { harvestArticleList } from "../ingest/fetchArticleList.js";
import { harvestPdf } from "../ingest/fetchPdf.js";
import { BLOCKED_TITLE } from "../ingest/page.js";
import { readJson, updateJson } from "../lib/store.js";
import { query } from "../lib/db.js";
import { SOURCES_STATE_KEY, FURTIF_RECHECK_MS } from "../ingest/harvestRun.js";
import { reliabilityOf } from "../../shared/sourceReliability.js";

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
export async function communes({ res, body, role }) {
  if (!guard(role, res)) return;
  const names = Array.isArray(body?.names) ? body.names.slice(0, 2000).map(String) : null;
  if (!names) return send(res, 400, { error: "corps attendu : { names: [...] }" });
  const covered = coveredOf(await readSettings());
  send(res, 200, { communes: Object.fromEntries(names.map((n) => [n, resolveCommune(n, covered)])) });
}

export async function restoreBaseline({ res, role }) {
  if (!guard(role, res)) return;
  try {
    const sources = await restoreSourcesFromBaseline({ author: role });
    journal("action", "référentiel des sources restauré", { level: "warn", detail: { total: sources.length } });
    send(res, 200, {
      ok: true,
      total: sources.length,
      active: sources.filter((s) => s.active).length,
    });
  } catch {
    send(res, 500, { error: "baseline introuvable (config/sources.{public,private}.baseline.yml)" });
  }
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

/* Test d'une source (M3-110) : le VRAI code de récolte (flux, page liste,
   sélecteur, PDF), mais en LECTURE SEULE et BORNÉ.
   - lecture seule : ni sources-state, ni rendement, ni notification, ni journal,
     ni SQL, ni seen.json (isSeen renvoie toujours faux). Ce module n'importe
     d'ailleurs aucune fonction d'écriture de la récolte ;
   - fenêtre courte : 14 jours, 6 contenus au plus ;
   - budget : 20 s au total (Promise.race), 15 s par requête ;
   - un seul test à la fois par source : un second appel reçoit 409.
   Même règle de type et d'URL que src/ingest/harvestRun.js (non exportée là). */
const TEST_FENETRE_MS = 14 * 86400000;
const TEST_MAX_ITEMS = 6;
const TEST_BUDGET_MS = 20000;
const TEST_REQUETE_MS = 15000;
const enCours = new Set();

function typeEffectif(s) {
  if (s.rssUrl) return "rss";
  const u = s.listUrl || s.pressUrl || s.siteUrl || "";
  if (/\.pdf($|\?)/i.test(u)) return "pdf";
  if (s.listUrl || s.pressUrl) return "article";
  if (s.siteUrl) return "site";
  return "none";
}

export async function testerSourceLectureSeule(s, { maintenant = Date.now(), budgetMs = TEST_BUDGET_MS, timeoutMs = TEST_REQUETE_MS, suivre = () => {} } = {}) {
  const debut = Date.now();
  const type = typeEffectif(s);
  const url = type === "rss" ? s.rssUrl : (s.listUrl || s.pressUrl || s.siteUrl);
  const fin = (o) => ({ ok: false, via: null, http: null, items: 0, complets: 0, exemples: [], dureeMs: Date.now() - debut, erreur: null, antiRobot: false, ...o });
  if (type === "none" || !url) return fin({ erreur: "aucune URL renseignée" });
  const opts = { timeoutMs: Math.min(timeoutMs, TEST_REQUETE_MS), maxItems: TEST_MAX_ITEMS, cutoffMs: maintenant - TEST_FENETRE_MS, isSeen: () => false };
  let timer;
  const delai = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, error: "délai dépassé (20 s)", items: [] }), Math.min(budgetMs, TEST_BUDGET_MS)); });
  let r;
  try {
    const run = type === "rss" ? harvestFeed(url, opts)
      : type === "pdf" ? harvestPdf(url, opts)
      : harvestArticleList(url, { ...opts, selector: s.selector });
    suivre(run);
    r = await Promise.race([run, delai]);
  } catch (err) {
    r = { ok: false, error: err.message || String(err), items: [] };
  } finally {
    clearTimeout(timer);
  }
  const items = r.items || [];
  const m = /HTTP (\d{3})/.exec(r.error || "");
  const http = m ? Number(m[1]) : (r.ok ? 200 : null);
  const antiRobot = !r.ok && ([403, 429, 503].includes(http) || BLOCKED_TITLE.test(r.error || ""));
  const complets = items.filter((it) => String(it.rawText ?? it.text ?? "").length >= 500).length;
  return fin({
    ok: !!r.ok, via: r.diag?.via || (r.ok ? type : null), http, items: items.length, complets,
    exemples: items.slice(0, 3).map((it) => String(it.title || "")),
    erreur: r.ok ? null : (r.error || "échec"), antiRobot,
  });
}

/* Verrou : un seul test à la fois par source (409 sinon). Après un délai
   dépassé, la récolte n'est pas annulable et continue jusqu'à son propre
   timeout : le verrou n'est rendu qu'une fois elle aussi terminée, sinon un
   second clic lancerait des requêtes en parallèle sur le même site. */
export async function testerAvecVerrou(s, opts = {}) {
  if (enCours.has(s.id)) return { status: 409, body: { ok: false, erreur: "test déjà en cours" } };
  enCours.add(s.id);
  let enVol = null;
  const suivre = (p) => { enVol = Promise.resolve(p).catch(() => {}).finally(() => { enVol = null; }); };
  try {
    return { status: 200, body: await testerSourceLectureSeule(s, { ...opts, suivre }) };
  } finally {
    if (enVol) enVol.finally(() => enCours.delete(s.id));
    else enCours.delete(s.id);
  }
}

export async function test({ res, params }) {
  const sources = await readSources();
  const s = sources.find((x) => x.id === params[0]);
  if (!s) return send(res, 404, { error: "source introuvable" });
  const { status, body } = await testerAvecVerrou(s);
  send(res, status, body);
}
