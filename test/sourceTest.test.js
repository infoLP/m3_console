/* T21c — test d'une source, communes et restauration du référentiel : la
   console DÉPOSE une demande au moteur (src/lib/demandes.js) et rend son
   résultat ; le test lui-même vit dans M3 (src/ingest/testSource.js). Demandes,
   référentiel et réponse simulés par `mock.module` : ni base ni réseau. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

if (typeof mock.module !== "function") {
  test("sources : demandes au moteur", { skip: "lancer `npm test` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../src/", import.meta.url);
  const deposees = [];
  let fin = {};          // ce que attendreJob rend en plus : { result } ou { error }
  mock.module(new URL("lib/demandes.js", root).href, {
    namedExports: {
      enqueue: async (kind, params, user) => { deposees.push({ kind, params, par: user?.login ?? null }); return { id: 41 }; },
      attendreJob: async (id) => ({ id, finishedAt: "2026-10-28T15:00:00Z", ...fin }),
    },
  });
  mock.module(new URL("lib/yamlStore.js", root).href, {
    namedExports: { readSources: async () => [{ id: "a", name: "A" }], writeSources: async () => [] },
  });
  mock.module(new URL("lib/journal.js", root).href, { namedExports: { journal: () => {} } });
  mock.module(new URL("lib/store.js", root).href, { namedExports: { readJson: async () => ({}), updateJson: async () => ({}) } });
  mock.module(new URL("lib/db.js", root).href, { namedExports: { query: async () => ({ rows: [] }) } });
  mock.module(new URL("lib/http.js", root).href, {
    namedExports: { send: (res, status, body) => { res.status = status; res.body = body; } },
  });
  const sources = await import(new URL("api/sources.js", root).href);
  const admin = { role: "administrateur", user: { login: "admin@ex.fr" } };
  const appel = async (h, ctx) => { const res = {}; await h({ res, params: [], body: {}, ...admin, ...ctx }); return res; };
  test.beforeEach(() => { deposees.length = 0; fin = {}; });

  test("tester : demande test_source pour cette source, résultat rendu tel quel", async () => {
    fin = { result: { ok: true, via: "rss", items: 4 } };
    const r = await appel(sources.test, { params: ["a"] });
    assert.deepEqual(deposees, [{ kind: "test_source", params: { sourceId: "a" }, par: "admin@ex.fr" }]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, via: "rss", items: 4 });
  });

  test("tester : source inconnue → 404 sans demande ; test en cours → 409", async () => {
    assert.equal((await appel(sources.test, { params: ["zz"] })).status, 404);
    assert.equal(deposees.length, 0);
    fin = { error: "test déjà en cours" };
    const r = await appel(sources.test, { params: ["a"] });
    assert.equal(r.status, 409);
    assert.equal(r.body.erreur, "test déjà en cours");
  });

  test("communes : demande resolve_communes, réservée à l'administrateur", async () => {
    fin = { result: { communes: { Rennes: { dept: "35" } } } };
    const r = await appel(sources.communes, { body: { names: ["Rennes"] } });
    assert.deepEqual(deposees[0].params, { names: ["Rennes"] });
    assert.deepEqual(r.body, { communes: { Rennes: { dept: "35" } } });
    assert.equal((await appel(sources.communes, { body: {} })).status, 400);
    assert.equal((await appel(sources.communes, { role: "relecteur", body: { names: ["x"] } })).status, 403);
    assert.equal(deposees.length, 1);
  });

  test("restauration : demande restore_sources, totaux rendus ; erreur du moteur → 500", async () => {
    fin = { result: { ok: true, total: 12, active: 9 } };
    const r = await appel(sources.restoreBaseline);
    assert.equal(deposees[0].kind, "restore_sources");
    assert.deepEqual(r.body, { ok: true, total: 12, active: 9 });
    fin = { error: "baseline introuvable (config/sources.{public,private}.baseline.yml)" };
    const e = await appel(sources.restoreBaseline);
    assert.equal(e.status, 500);
    assert.match(e.body.error, /baseline introuvable/);
  });

  test("frontière : api/sources.js n'importe plus le moteur", () => {
    const src = fs.readFileSync(new URL("api/sources.js", root), "utf8");
    for (const m of src.matchAll(/from "([^"]+)"/g)) {
      assert.doesNotMatch(m[1], /\/(ingest|generate|publish|llm|schedule|jobs|tools)\//, m[1]);
    }
  });
}
