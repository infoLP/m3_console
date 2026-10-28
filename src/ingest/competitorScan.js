/* Scan des concurrents (M3-121, T11) : crawl de chaque concurrent actif, domaines
   candidats cumulés dans `competitor_candidates` (migration 021).

   - À part de la récolte : son propre bail « competitors » (src/lib/runLock.js),
     distinct de « chain ». Un scan ne bloque ni la récolte ni la génération, et
     un second scan pendant le premier rend { skipped: "busy" } sans erreur.
   - Lancé par l'ordonnanceur aux créneaux de `competitors_scan_times` quand
     `competitors_scan_enabled` = oui, ou par le bouton de Sources → Concurrents
     (M3-122), même désactivé.
   - Garde SSRF (safeFetch.js) : le concurrent est jugé avant son crawl, et chaque
     requête du crawl passe par une résolution validée.
   - Candidat déjà connu : occurrences cumulées sur les seuls articles qu'il
     n'avait pas encore (un article relu au scan suivant ne recompte pas),
     concurrents et articles fusionnés, articles bornés aux ARTICLES_MAX plus
     récents ; le statut décidé (ajouté, écarté…) n'est jamais touché.
   - Écrit contre un dépôt (`pgRepo` en production, un dépôt en mémoire dans
     test/competitorScan.test.js), comme src/lib/competitors.js.

   Contrat de M3-122 (A) : runCompetitorScan, listCandidates, setCandidateStatus,
   scanState. Ne pas en changer les signatures ni les formes rendues. */

import { query as pgQuery } from "../lib/db.js";
import { acquire, release, holder } from "../lib/runLock.js";
import { journal } from "../lib/journal.js";
import { readJson, writeJson, pushCollection } from "../lib/store.js";
import { readSettings } from "../lib/yamlStore.js";
import { log } from "../lib/log.js";
import { competitorCandidates } from "./concurrents.js";
import { refusedUrl, safeFetcher } from "./safeFetch.js";
import { scanSettings, upcomingSlot, slotToIso } from "../schedule/slots.js";

export const SCAN_LOCK = "competitors";
export const LAST_SCAN_KEY = "competitors/lastScan.json";
export const CANDIDATE_STATUSES = ["nouveau", "propose", "ajoute", "ecarte"];
export const ARTICLES_MAX = 20;
const LOCK_TTL_MS = 3600000; // un scan tué ne bloque le suivant qu'une heure

const fail = (status, message) => Object.assign(new Error(message), { status });

/* Fusion d'un candidat du crawl d'un concurrent dans la ligne existante (ou null).
   `crawled` : les articles lus ({ url, links: [{ domain }] }), pour compter les
   occurrences des seuls articles nouveaux pour ce domaine. Pure. */
export function mergeCandidate(existing, cand, competitor, crawled = []) {
  const seen = new Set((existing?.articles || []).map((a) => a.url));
  const fresh = cand.articles.filter((a) => !seen.has(a.url));
  const freshUrls = new Set(fresh.map((a) => a.url));
  const added = crawled.filter((a) => freshUrls.has(a.url))
    .reduce((n, a) => n + (a.links || []).filter((l) => l.domain === cand.domain).length, 0);
  const others = (existing?.competitors || []).filter((c) => Number(c.id) !== Number(competitor.id));
  return {
    domain: cand.domain,
    occurrences: (existing?.occurrences || 0) + added,
    competitors: [...others, { id: Number(competitor.id), label: competitor.label }],
    articles: [...fresh.map((a) => ({ url: a.url, title: a.title || "", competitorId: Number(competitor.id) })), ...(existing?.articles || [])].slice(0, ARTICLES_MAX),
  };
}

export function toPublicCandidate(row) {
  const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
  return {
    id: Number(row.id),
    domain: row.domain,
    status: row.status,
    occurrences: Number(row.occurrences),
    competitors: row.competitors || [],
    articles: row.articles || [],
    firstSeenAt: iso(row.first_seen_at),
    lastSeenAt: iso(row.last_seen_at),
    decidedBy: row.decided_by || null,
    decidedAt: iso(row.decided_at),
  };
}

/* ok : des articles lus ; erreur : rien n'a pu être lu (adresse invalide,
   robots.txt du concurrent injoignable, cf. crawlCompetitor) ; vide sinon. */
const scanStatus = (r) => (r.articles.length ? "ok" : /^(URL invalide|robots\.txt injoignable)/.test(r.error || "") ? "erreur" : "vide");

export function createCompetitorScan({
  repo = pgRepo(),
  lock = { acquire, release, holder },
  crawl = competitorCandidates,
  refused = refusedUrl,
  fetcher = safeFetcher(),
  settings = readSettings,
  store = { readJson, writeJson, pushCollection },
  note = journal,
  now = () => Date.now(),
} = {}) {
  /* Un concurrent : garde, crawl, candidats fusionnés, last_scan_*. Rend les
     domaines nouveaux ; une erreur est notée sur le concurrent et remontée. */
  async function scanOne(c, { known, exclude, maxArticles }) {
    const why = await refused(c.url);
    if (why) throw Object.assign(new Error(`adresse refusée : ${why}`), { refused: true });
    const r = await crawl(c.url, { known, exclude, maxArticles, fetcher });
    const fresh = [];
    for (const cand of r.candidates) {
      const existing = await repo.candidate(cand.domain);
      await repo.saveCandidate(mergeCandidate(existing, cand, c, r.articles));
      if (!existing) fresh.push(cand);
    }
    const status = scanStatus(r);
    await repo.scanned(c.id, { status, via: r.via || null, error: r.error || null });
    return { status, error: r.error || null, fresh };
  }

  return {
    async runCompetitorScan({ trigger = "manuel", by = null } = {}) {
      const owner = trigger === "planifie" ? "scan planifié des concurrents" : `scan manuel des concurrents${by ? ` (${by})` : ""}`;
      const token = await lock.acquire(SCAN_LOCK, { ttlMs: LOCK_TTL_MS, owner });
      if (!token) return { skipped: "busy" };
      try {
        const at = new Date(now()).toISOString();
        const { maxArticles } = scanSettings(await settings());
        const competitors = await repo.activeCompetitors();
        const known = await repo.knownUrls();
        const exclude = (await repo.allCompetitorUrls()).filter(Boolean);
        const fresh = new Map();
        const errors = [];
        for (const c of competitors) {
          try {
            const r = await scanOne(c, { known, exclude, maxArticles });
            for (const cand of r.fresh) if (!fresh.has(cand.domain)) fresh.set(cand.domain, cand);
            if (r.status === "erreur") errors.push({ id: Number(c.id), label: c.label, error: r.error }); // rien lu (robots.txt injoignable…)
          } catch (err) {
            errors.push({ id: Number(c.id), label: c.label, error: err.message });
            await repo.scanned(c.id, { status: "erreur", via: null, error: String(err.message).slice(0, 500) })
              .catch((e) => log.error("concurrents", "last_scan", { concurrent: c.id, erreur: e.message }));
          }
        }
        const last = { at, trigger, by, competitors: competitors.length, errors: errors.length, candidates: fresh.size };
        await store.writeJson(LAST_SCAN_KEY, last);
        const top = [...fresh.values()].sort((a, b) => b.occurrences - a.occurrences || a.domain.localeCompare(b.domain)).map((c) => c.domain);
        if (fresh.size) {
          await store.pushCollection("notifications", {
            id: `n-${now()}-concurrents`, type: "competitors_candidates", severity: "info",
            detail: `Scan ${trigger === "planifie" ? "planifié" : "manuel"} des concurrents : ${fresh.size} nouveau${fresh.size > 1 ? "x" : ""} domaine${fresh.size > 1 ? "s" : ""} candidat${fresh.size > 1 ? "s" : ""} (${top.slice(0, 3).join(", ")}${fresh.size > 3 ? "…" : ""}).`,
            at: new Date(now()).toISOString(), read: false,
          });
        }
        note("chaine", "scan des concurrents", { level: errors.length ? "warn" : "info", detail: { ...last, nouveaux: top.slice(0, 10), erreurs: errors } });
        log.info("concurrents", "scan", { declencheur: trigger, concurrents: competitors.length, erreurs: errors.length, nouveaux: fresh.size });
        return last;
      } finally {
        await lock.release(SCAN_LOCK, token);
      }
    },

    async listCandidates({ status, limit = 100 } = {}) {
      if (status != null && !CANDIDATE_STATUSES.includes(status)) throw fail(400, `statut inconnu : ${status}`);
      const n = Math.min(Math.max(Math.round(Number(limit)) || 100, 1), 500);
      return (await repo.listCandidates({ status: status ?? null, limit: n })).map(toPublicCandidate);
    },

    async setCandidateStatus(id, status, by = null) {
      if (!CANDIDATE_STATUSES.includes(status)) throw fail(400, `statut inconnu : ${status}`);
      const row = /^\d+$/.test(String(id)) ? await repo.setCandidateStatus(Number(id), status, by) : null;
      if (!row) throw fail(404, `candidat inconnu : ${id}`);
      return toPublicCandidate(row);
    },

    async scanState() {
      const s = scanSettings(await settings());
      const h = await lock.holder(SCAN_LOCK);
      return {
        running: !!h,
        startedAt: h?.since || null,
        last: (await store.readJson(LAST_SCAN_KEY, null)) || null,
        enabled: s.enabled,
        next: s.enabled && s.times.times ? slotToIso(upcomingSlot(s.times.times, now())) : null,
      };
    },
  };
}

/* --------------------------------------------------------------- dépôt */

export function pgRepo(query = pgQuery) {
  return {
    async activeCompetitors() {
      return (await query("SELECT id, label, url FROM competitors WHERE active ORDER BY id")).rows;
    },
    async allCompetitorUrls() {
      return (await query("SELECT url FROM competitors")).rows.map((r) => r.url);
    },
    /* Le référentiel : toutes les adresses de la table sources, actives ou non. */
    async knownUrls() {
      const { rows } = await query("SELECT site_url, list_url, press_url, rss_url FROM sources");
      return rows.flatMap((r) => [r.site_url, r.list_url, r.press_url, r.rss_url]).filter(Boolean);
    },
    async candidate(domain) {
      return (await query("SELECT * FROM competitor_candidates WHERE domain = $1", [domain])).rows[0] || null;
    },
    /* Le statut n'est ni écrit ni écrasé ici : une décision survit aux scans. */
    async saveCandidate(c) {
      await query(
        `INSERT INTO competitor_candidates (domain, occurrences, competitors, articles)
         VALUES ($1, $2, $3::jsonb, $4::jsonb)
         ON CONFLICT (domain) DO UPDATE SET occurrences = EXCLUDED.occurrences,
           competitors = EXCLUDED.competitors, articles = EXCLUDED.articles, last_seen_at = now()`,
        [c.domain, c.occurrences, JSON.stringify(c.competitors), JSON.stringify(c.articles)]
      );
    },
    async scanned(id, { status, via, error }) {
      await query(
        "UPDATE competitors SET last_scan_at = now(), last_scan_status = $2, last_scan_via = $3, last_scan_error = $4 WHERE id = $1",
        [id, status, via, error]
      );
    },
    async listCandidates({ status, limit }) {
      const { rows } = status
        ? await query("SELECT * FROM competitor_candidates WHERE status = $1 ORDER BY last_seen_at DESC, id DESC LIMIT $2", [status, limit])
        : await query("SELECT * FROM competitor_candidates ORDER BY last_seen_at DESC, id DESC LIMIT $1", [limit]);
      return rows;
    },
    /* Remettre « nouveau » efface la décision. */
    async setCandidateStatus(id, status, by) {
      const { rows } = await query(
        `UPDATE competitor_candidates SET status = $2,
           decided_by = CASE WHEN $2 = 'nouveau' THEN NULL ELSE $3 END,
           decided_at = CASE WHEN $2 = 'nouveau' THEN NULL ELSE now() END
         WHERE id = $1 RETURNING *`,
        [id, status, by]
      );
      return rows[0] || null;
    },
  };
}

/* Instance de production, créée au premier appel (pas de pool ni de lecture à l'import). */
let instance = null;
const scan = () => (instance ||= createCompetitorScan());

export const runCompetitorScan = (opts) => scan().runCompetitorScan(opts);
export const listCandidates = (opts) => scan().listCandidates(opts);
export const setCandidateStatus = (id, status, by) => scan().setCandidateStatus(id, status, by);
export const scanState = () => scan().scanState();
