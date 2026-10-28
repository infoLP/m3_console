/* M3-53, T19c — la route de parution (src/api/articles.js) ne publie plus elle-
   même : elle refuse ce qui ne doit pas partir, puis dépose la demande « publish »
   avec la cible, la date et la personne. L'aiguillage vers la cible, le refus de
   la parution programmée sur WordPress et les échecs du site sont faits par le
   moteur (M3 : src/jobs/taches/publish.js, test/wordpressPublishTache.test.js).
   Base simulée par `mock.module`, qui exige --experimental-test-module-mocks :
   `npm test` saute ce fichier, `npm run test:wiring` le lance. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("parution vers une cible WordPress", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const articles = new Map();
  const noop = async () => null;
  mock.module(new URL("lib/store.js", root).href, {
    namedExports: {
      readArticle: async (id) => structuredClone(articles.get(id) || null),
      writeArticle: async (a) => { articles.set(a.id, structuredClone(a)); },
      ROOT: ".", dataPath: (...p) => p.join("/"), readJson: noop, writeJson: noop,
      readCollection: async () => [], writeCollection: noop, filterCollection: async () => 0, pushCollection: noop,
      listArticleIds: async () => [], clearArticles: async () => ({}), clearAllData: noop,
      INDEX_LIMIT_DEFAULT: 100, INDEX_LIMIT_MAX: 500, readIndex: async () => ({}),
      HISTORY_STATUSES: [], HISTORY_LIMIT_DEFAULT: 50, readHistory: async () => ({}),
    },
  });
  const q = async () => ({ rows: [], rowCount: 0 });
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  const deposes = [];
  mock.module(new URL("lib/demandes.js", root).href, {
    namedExports: {
      enqueue: async (kind, params, user) => { deposes.push({ kind, params, user }); return { id: deposes.length, kind, duplicate: false }; },
      attendreJob: async () => ({ result: null, error: null }),
    },
  });

  const A = await import(new URL("api/articles.js", root).href);

  const USER = { id: "u1", name: "Admin", login: "admin", role: "administrateur" };
  const call = async (fn, ctx) => {
    let status = 0, body = null;
    const res = { setHeader() {}, writeHead(c) { status = c; }, end(b) { body = b ? JSON.parse(b) : null; } };
    await fn({ res, role: "administrateur", user: USER, body: {}, ...ctx });
    return { status, body };
  };
  const put = (id, extra = {}) => articles.set(id, { id, status: "a_revoir", provider: "openrouter", title: "t", chapo: "", body: [], zone: {}, seo: {}, ...extra });

  test("parution acceptée : 202, demande « publish » avec cible, date et personne ; l'article n'est pas touché ici", async () => {
    deposes.length = 0;
    put("a");
    const r = await call(A.publish, { params: ["a"], body: { targetId: 3, scheduledAt: "2026-10-30T06:00:00.000Z" } });
    assert.equal(r.status, 202);
    assert.equal(r.body.job.kind, "publish");
    assert.deepEqual(deposes[0].params, {
      articleId: "a", targetId: 3, scheduledAt: "2026-10-30T06:00:00.000Z",
      user: { id: "u1", name: "Admin", login: "admin", role: "administrateur" }, role: "administrateur",
    });
    assert.equal(articles.get("a").status, "a_revoir");
  });

  test("article déjà envoyé sur WordPress : refus 409 (pas de doublon sur le site), rien de déposé", async () => {
    deposes.length = 0;
    put("w", { publication: { wpId: 42 } });
    const r = await call(A.publish, { params: ["w"] });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /n° 42/);
    assert.equal(deposes.length, 0);
  });

  test("purgé ou introuvable : refus, rien de déposé", async () => {
    deposes.length = 0;
    put("x", { status: "purge" });
    assert.equal((await call(A.publish, { params: ["x"] })).status, 409);
    assert.equal((await call(A.publish, { params: ["absent"] })).status, 404);
    assert.equal(deposes.length, 0);
  });
}
