/* T23c — src/lib/candidatsConcurrents.js : état du scan et domaines candidats,
   côté console, en SQL seul. Même contrat que src/ingest/competitorScan.js de
   M3 (scanState, listCandidates, setCandidateStatus) ; base et kv simulés. */

import test from "node:test";
import assert from "node:assert/strict";
import { createCandidats, toPublicCandidate, SCAN_LOCK_KEY, LAST_SCAN_KEY } from "../src/lib/candidatsConcurrents.js";

const NOW = Date.parse("2026-10-27T10:00:00Z");

function monter({ kv = {}, settings = { competitors_scan_enabled: "oui", competitors_scan_times: "02:30, 14:00" }, rows = [] } = {}) {
  const sql = [];
  const deposees = [];
  const query = async (texte, params = []) => {
    sql.push({ texte, params });
    if (texte.startsWith("UPDATE competitor_candidates")) {
      const r = rows.find((x) => Number(x.id) === params[0]);
      if (!r) return { rows: [] };
      Object.assign(r, { status: params[1], decided_by: params[1] === "nouveau" ? null : params[2] });
      return { rows: [r] };
    }
    const filtre = texte.includes("WHERE status") ? rows.filter((r) => r.status === params[0]) : rows;
    return { rows: filtre.slice(0, params.at(-1)) };
  };
  const c = createCandidats({
    query, lire: async (k, fb = null) => kv[k] ?? fb, settings: async () => settings,
    deposer: async (kind, params, user) => { deposees.push({ kind, params, user }); return { id: 3, duplicate: false }; },
    now: () => NOW,
  });
  return { c, sql, deposees };
}

const ligne = (id, status = "nouveau") => ({
  id: String(id), domain: `d${id}.fr`, status, occurrences: "2", competitors: [], articles: [],
  first_seen_at: new Date(NOW), last_seen_at: new Date(NOW), decided_by: null, decided_at: null,
});

test("scanState : bail libre, prochain créneau ; bail tenu → running ; bail expiré → libre", async () => {
  assert.deepEqual(await monter().c.scanState(), { running: false, startedAt: null, last: null, enabled: true, next: "2026-10-27T13:00:00.000Z" });
  const last = { at: "2026-10-27T09:00:00.000Z", trigger: "manuel", competitors: 2, errors: 0, candidates: 1 };
  const tenu = { [SCAN_LOCK_KEY]: { owner: "x", since: "2026-10-27T09:55:00.000Z", expiresAt: "2026-10-27T10:55:00.000Z" }, [LAST_SCAN_KEY]: last };
  assert.deepEqual(await monter({ kv: tenu }).c.scanState(), { running: true, startedAt: "2026-10-27T09:55:00.000Z", last, enabled: true, next: "2026-10-27T13:00:00.000Z" });
  const expire = { [SCAN_LOCK_KEY]: { owner: "x", since: "2026-10-27T08:00:00.000Z", expiresAt: "2026-10-27T09:00:00.000Z" } };
  assert.equal((await monter({ kv: expire }).c.scanState()).running, false);
  assert.equal((await monter({ settings: { competitors_scan_enabled: "non" } }).c.scanState()).next, null);
});

test("listCandidates : forme publique, filtre de statut, borne ; statut inconnu → 400", async () => {
  const { c, sql } = monter({ rows: [ligne(1), ligne(2, "ecarte")] });
  const l = await c.listCandidates({ status: "nouveau", limit: 9999 });
  assert.deepEqual(l.map((x) => x.id), [1]);
  assert.deepEqual(Object.keys(l[0]), ["id", "domain", "status", "occurrences", "competitors", "articles", "firstSeenAt", "lastSeenAt", "decidedBy", "decidedAt"]);
  assert.equal(sql[0].params.at(-1), 500);
  await assert.rejects(c.listCandidates({ status: "n'importe" }), (e) => e.status === 400);
});

test("setCandidateStatus : décision enregistrée ; statut inconnu → 400 ; candidat inconnu ou id invalide → 404", async () => {
  const { c } = monter({ rows: [ligne(1)] });
  const done = await c.setCandidateStatus(1, "ecarte", "Camille");
  assert.equal(done.status, "ecarte");
  assert.equal(done.decidedBy, "Camille");
  await assert.rejects(c.setCandidateStatus(1, "supprime", "x"), (e) => e.status === 400);
  await assert.rejects(c.setCandidateStatus(999, "ecarte", "x"), (e) => e.status === 404);
  await assert.rejects(c.setCandidateStatus("abc", "ecarte", "x"), (e) => e.status === 404);
});

test("demanderScan : une demande competitor_scan au nom de l'utilisateur", async () => {
  const { c, deposees } = monter();
  const user = { login: "su@ex.fr" };
  assert.equal((await c.demanderScan(user)).id, 3);
  assert.deepEqual(deposees, [{ kind: "competitor_scan", params: {}, user }]);
});

test("toPublicCandidate : dates en ISO, nombres en nombres", () => {
  const p = toPublicCandidate(ligne(4));
  assert.equal(p.id, 4);
  assert.equal(p.occurrences, 2);
  assert.equal(p.lastSeenAt, "2026-10-27T10:00:00.000Z");
});
