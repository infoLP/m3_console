/* M3-84 — un texte écrit par le générateur de secours (mock) ne part pas en
   parution. Routes réelles (src/api/articles.js), base simulée par `mock.module`,
   qui exige l'option --experimental-test-module-mocks : `npm test` saute ce
   fichier, `npm run test:wiring` le lance. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { writtenByMock, readyTitle } from "../../shared/model.js";

test("readyTitle : un texte du mock n'est jamais « prêt », même à 5/5", () => {
  const A = { passed: 5, total: 5, ready: true };
  assert.equal(readyTitle({ provider: "openrouter" }, A), "Prêt pour la parution");
  assert.match(readyTitle({ provider: "mock" }, A), /remplissage/);
  assert.equal(writtenByMock({ provider: "mock" }), true);
  assert.equal(writtenByMock({}), false);
});

if (typeof mock.module !== "function") {
  test("refus de parution d'un texte du mock", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const articles = new Map();
  let published = 0;

  /* Toutes les exportations de store.js : articles.js importe aussi pipeline.js et
     rescore.js, qui en lisent d'autres. Seules les deux premières servent ici. */
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
  /* La base elle-même, plutôt que yamlStore.js : ses nombreuses exportations restent
     réelles, et readSettings retombe sur les défauts d'une table vide. */
  const q = async () => ({ rows: [], rowCount: 0 });
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  mock.module(new URL("publish/simulated.js", root).href, {
    namedExports: { publish: async () => { published++; return { scheduledAt: null, publishedAt: new Date().toISOString(), url: "x" }; } },
  });

  const A = await import(new URL("api/articles.js", root).href);
  const call = async (fn, ctx) => {
    let status = 0, body = null;
    const res = { setHeader() {}, writeHead(c) { status = c; }, end(b) { body = b ? JSON.parse(b) : null; } };
    await fn({ res, role: "administrateur", user: { id: "u1", name: "Admin" }, body: {}, ...ctx });
    return { status, body };
  };
  const put = (id, provider) => articles.set(id, { id, status: "a_revoir", provider, title: "t", chapo: "", body: [], zone: {}, seo: {} });

  test("texte du mock : parution et validation refusées (409), classement permis", async () => {
    put("m", "mock");
    let r = await call(A.publish, { params: ["m"], body: {} });
    assert.equal(r.status, 409); assert.match(r.body.error, /sans LLM/); assert.equal(published, 0);
    r = await call(A.setStatus, { params: ["m"], body: { status: "valide" } });
    assert.equal(r.status, 409);
    r = await call(A.setStatus, { params: ["m"], body: { status: "publie" } });
    assert.equal(r.status, 409);
    r = await call(A.setStatus, { params: ["m"], body: { status: "archive" } });
    assert.equal(r.status, 200, "le classer sans diffusion reste possible");
  });

  /* M3-85 : régénérer un sujet hors zone est refusé AVANT tout appel LLM, sauf
     confirmation. Sans `force`, la réponse arrive sans charger le moteur. */
  test("régénération d'un sujet hors zone : 409 sans confirmation", async () => {
    articles.set("hz", { id: "hz", status: "a_revoir", provider: "openrouter", title: "t", chapo: "", body: [], seo: {},
      zone: { num: "HS", outsideNA: true }, zoneClass: "nonhab" });
    const r = await call(A.regenerate, { params: ["hz"], body: {} });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "hors_zone");
  });

  test("texte d'un vrai LLM : parution acceptée", async () => {
    put("r", "openrouter");
    const r = await call(A.publish, { params: ["r"], body: {} });
    assert.equal(r.status, 200); assert.equal(published, 1);
  });
}
