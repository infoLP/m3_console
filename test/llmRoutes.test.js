/* T20c — routes de l'onglet LLM (src/api/llm.js) dans la console séparée : test
   de connexion, catalogue et aperçu du prompt sont DÉPOSÉS au moteur (demandes
   test_llm, fetch_models, preview_prompt) et attendus ; le contrôle de liste
   blanche à l'enregistrement d'un modèle (isModelSavable) reste dans la console.
   File et base simulées par `mock.module` : `npm run test:wiring` / `npm test`. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("routes LLM de la console", { skip: "lancer avec --experimental-test-module-mocks" }, () => {});
} else {
  const root = new URL("../src/", import.meta.url);
  const deposes = [];
  let reponse = { result: null, error: null };
  let etat = { vivant: true, llm: null };
  mock.module(new URL("lib/demandes.js", root).href, {
    namedExports: {
      enqueue: async (kind, params, user) => { deposes.push({ kind, params, user }); return { id: deposes.length, kind, duplicate: false }; },
      attendreJob: async (id) => ({ id, finishedAt: "t", ...reponse }),
      lireEtatMoteur: async () => etat,
    },
  });
  /* Base : un seul moteur, sans liste blanche d'exemption (anthropic). */
  const MOTEUR = { id: "anthropic", kind: "anthropic", label: "Anthropic", base_url: "https://api.anthropic.com", default_model: null, models: [], enabled: true };
  const requetes = [];
  const q = async (sql, params) => {
    requetes.push(sql);
    if (/FROM llm_providers WHERE id/.test(sql)) return { rows: params?.[0] === "anthropic" ? [{ ...MOTEUR }] : [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  mock.module(new URL("lib/journal.js", root).href, { namedExports: { journal: () => {} } });

  const A = await import(new URL("api/llm.js", root).href);
  const USER = { id: "u1", login: "admin", name: "Admin", role: "administrateur" };
  const call = async (fn, ctx) => {
    let status = 0, body = null;
    const res = { setHeader() {}, writeHead(c) { status = c; }, end(b) { body = b ? JSON.parse(b) : null; } };
    await fn({ res, role: "administrateur", user: USER, body: {}, params: [], ...ctx });
    return { status, body };
  };

  test("test de connexion : demande test_llm déposée, verdict du moteur rendu tel quel", async () => {
    deposes.length = 0;
    reponse = { result: { ok: true, ms: 420, model: "claude-x" }, error: null };
    const r = await call(A.test, { params: ["anthropic"] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, ms: 420, model: "claude-x" });
    assert.deepEqual(deposes.map((d) => [d.kind, d.params]), [["test_llm", { provider: "anthropic" }]]);
  });

  test("test de connexion : refus du moteur → 404 (inconnu) ou 400, avec son message", async () => {
    reponse = { result: null, error: "moteur inconnu" };
    assert.equal((await call(A.test, { params: ["x"] })).status, 404);
    reponse = { result: null, error: "aucune clé d'API enregistrée pour ce moteur" };
    const r = await call(A.test, { params: ["anthropic"] });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /aucune clé/);
  });

  test("catalogue : demande fetch_models, puis le moteur relu en base sans clé ; échec → 502", async () => {
    deposes.length = 0;
    reponse = { result: { provider: "anthropic", count: 12 }, error: null };
    const r = await call(A.fetchModels, { params: ["anthropic"] });
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 12);
    assert.equal(r.body.provider.id, "anthropic");
    assert.equal(deposes[0].kind, "fetch_models");
    reponse = { result: null, error: "Récupération impossible — 401" };
    assert.equal((await call(A.fetchModels, { params: ["anthropic"] })).status, 502);
  });

  test("aperçu du prompt : demande preview_prompt avec le gabarit", async () => {
    deposes.length = 0;
    reponse = { result: { ok: true, errors: [], text: "…" }, error: null };
    const r = await call(A.previewPrompt, { body: { template: "Mon gabarit {{source}}" } });
    assert.equal(r.status, 200);
    assert.deepEqual(deposes[0], { kind: "preview_prompt", params: { template: "Mon gabarit {{source}}" }, user: USER });
  });

  test("réservé à l'administrateur : 403 sans rien déposer", async () => {
    deposes.length = 0;
    for (const fn of [A.test, A.fetchModels, A.previewPrompt]) {
      assert.equal((await call(fn, { role: "relecteur", params: ["anthropic"] })).status, 403);
    }
    assert.equal(deposes.length, 0);
  });

  test("enregistrement : un modèle hors liste blanche est refusé par la console (isModelSavable)", async () => {
    requetes.length = 0;
    await assert.rejects(call(A.save, { params: ["anthropic"], body: { defaultModel: "modele/hors-liste-blanche" } }), /enregistrement refusé/);
    assert.ok(!requetes.some((s) => /^\s*UPDATE/i.test(s)), "rien d'écrit");
  });
}
