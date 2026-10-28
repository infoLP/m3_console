/* Domaines candidats et état du scan des concurrents, côté console (T23c, lot 3F).

   Le scan lui-même tourne dans le moteur (demande « competitor_scan », voie
   « fond », src/jobs/taches/competitor_scan.js de M3) ; la console n'en garde
   que la lecture et la décision, en SQL seul, extrait du pgRepo de
   src/ingest/competitorScan.js de M3 — mêmes requêtes, mêmes formes rendues :
   - listCandidates, setCandidateStatus : table competitor_candidates (migration 021) ;
   - scanState : bail « competitors » (kv locks/competitors.json, même lecture que
     holder() de src/lib/runLock.js de M3), dernier scan (kv
     competitors/lastScan.json) et prochain créneau (shared/slots.js). */

import { query as pgQuery } from "./db.js";
import { readJson } from "./store.js";
import { readSettings } from "./yamlStore.js";
import { enqueue } from "./demandes.js";
import { scanSettings, upcomingSlot, slotToIso } from "../../shared/slots.js";

export const CANDIDATE_STATUSES = ["nouveau", "propose", "ajoute", "ecarte"];
export const SCAN_LOCK_KEY = "locks/competitors.json";
export const LAST_SCAN_KEY = "competitors/lastScan.json";

const fail = (status, message) => Object.assign(new Error(message), { status });

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

export function createCandidats({
  query = pgQuery, lire = readJson, settings = readSettings, deposer = enqueue, now = () => Date.now(),
} = {}) {
  return {
    async listCandidates({ status, limit = 100 } = {}) {
      if (status != null && !CANDIDATE_STATUSES.includes(status)) throw fail(400, `statut inconnu : ${status}`);
      const n = Math.min(Math.max(Math.round(Number(limit)) || 100, 1), 500);
      const { rows } = status
        ? await query("SELECT * FROM competitor_candidates WHERE status = $1 ORDER BY last_seen_at DESC, id DESC LIMIT $2", [status, n])
        : await query("SELECT * FROM competitor_candidates ORDER BY last_seen_at DESC, id DESC LIMIT $1", [n]);
      return rows.map(toPublicCandidate);
    },

    /* Remettre « nouveau » efface la décision. */
    async setCandidateStatus(id, status, by = null) {
      if (!CANDIDATE_STATUSES.includes(status)) throw fail(400, `statut inconnu : ${status}`);
      if (!/^\d+$/.test(String(id))) throw fail(404, `candidat inconnu : ${id}`);
      const { rows } = await query(
        `UPDATE competitor_candidates SET status = $2,
           decided_by = CASE WHEN $2 = 'nouveau' THEN NULL ELSE $3 END,
           decided_at = CASE WHEN $2 = 'nouveau' THEN NULL ELSE now() END
         WHERE id = $1 RETURNING *`,
        [Number(id), status, by]
      );
      if (!rows[0]) throw fail(404, `candidat inconnu : ${id}`);
      return toPublicCandidate(rows[0]);
    },

    async scanState() {
      const s = scanSettings(await settings());
      const bail = await lire(SCAN_LOCK_KEY, null);
      const h = bail && Date.parse(bail.expiresAt) > now() ? bail : null;
      return {
        running: !!h,
        startedAt: h?.since || null,
        last: (await lire(LAST_SCAN_KEY, null)) || null,
        enabled: s.enabled,
        next: s.enabled && s.times.times ? slotToIso(upcomingSlot(s.times.times, now())) : null,
      };
    },

    /* « Lancer le scan » : une demande au moteur, qui la prend sous son bail. */
    demanderScan(user) {
      return deposer("competitor_scan", {}, user);
    },
  };
}

/* Instance de production, créée au premier appel (pas de pool à l'import). */
let instance = null;
const candidats = () => (instance ||= createCandidats());

export const listCandidates = (opts) => candidats().listCandidates(opts);
export const setCandidateStatus = (id, status, by) => candidats().setCandidateStatus(id, status, by);
export const scanState = () => candidats().scanState();
export const demanderScan = (user) => candidats().demanderScan(user);
