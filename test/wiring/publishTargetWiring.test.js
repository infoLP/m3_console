/* M3-53 — la route de parution (src/api/articles.js) envoie vers la cible choisie
   par l'aiguillage, refuse ce qui ne doit pas partir, et ne touche pas l'article
   quand l'envoi échoue. Routes réelles, base et transport simulés par `mock.module`,
   qui exige --experimental-test-module-mocks : `npm test` saute ce fichier,
   `npm run test:wiring` le lance. */

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

  /* Doublures de l'aiguillage et du transport : ce que la route leur demande est
     enregistré, ce qu'elles répondent est piloté par chaque test. */
  const envoi = { appels: [], reponse: null, erreur: null };
  const aiguillage = { reponse: { mode: "simulated", target: null }, erreur: null };
  mock.module(new URL("publish/index.js", root).href, {
    namedExports: {
      publish: async (article, settings, opts) => {
        envoi.appels.push({ id: article.id, opts });
        if (envoi.erreur) throw envoi.erreur;
        return envoi.reponse;
      },
    },
  });
  mock.module(new URL("api/wpTargets.js", root).href, {
    namedExports: {
      targetForPublish: async () => { if (aiguillage.erreur) throw aiguillage.erreur; return aiguillage.reponse; },
    },
  });

  const A = await import(new URL("api/articles.js", root).href);
  const { WpError } = await import(new URL("publish/wpClient.js", root).href);

  const call = async (fn, ctx) => {
    let status = 0, body = null;
    const res = { setHeader() {}, writeHead(c) { status = c; }, end(b) { body = b ? JSON.parse(b) : null; } };
    await fn({ res, role: "administrateur", user: { id: "u1", name: "Admin", login: "admin" }, body: {}, ...ctx });
    return { status, body };
  };
  const put = (id, extra = {}) => articles.set(id, { id, status: "a_revoir", provider: "openrouter", title: "t", chapo: "", body: [], zone: {}, seo: {}, ...extra });
  const remettre = () => {
    envoi.appels = []; envoi.erreur = null;
    envoi.reponse = { scheduledAt: null, publishedAt: "2026-10-26T10:00:00.000Z", url: "https://simule.test/t", simulated: true };
    aiguillage.reponse = { mode: "simulated", target: null }; aiguillage.erreur = null;
  };

  test("publication simulée (défaut) : le publisher n'a pas de cible, l'article passe « publié »", async () => {
    remettre(); put("s");
    const r = await call(A.publish, { params: ["s"], body: {} });
    assert.equal(r.status, 200);
    assert.equal(envoi.appels.length, 1);
    assert.equal(envoi.appels[0].opts.target, null);
    assert.equal(articles.get("s").status, "publie");
    assert.equal(Object.hasOwn(articles.get("s").publication, "wpId"), false);
  });

  test("cible WordPress « brouillon » : l'article garde la trace de l'envoi", async () => {
    remettre(); put("w");
    const cible = { id: 7, name: "Vie économique", url: "https://wp.test", user: "c", appPassword: "x", publishStatus: "draft" };
    aiguillage.reponse = { mode: "wordpress", target: cible };
    envoi.reponse = { scheduledAt: null, publishedAt: "2026-10-26T10:00:00.000Z", url: "https://wp.test/?p=500", simulated: false, wpId: 500, wpStatus: "draft", sentAsDraft: true, targetName: "Vie économique" };
    const r = await call(A.publish, { params: ["w"], body: {} });
    assert.equal(r.status, 200);
    assert.equal(envoi.appels[0].opts.target, cible);
    assert.deepEqual(
      { ...articles.get("w").publication },
      { scheduledAt: null, publishedAt: "2026-10-26T10:00:00.000Z", url: "https://wp.test/?p=500", wpId: 500, wpStatus: "draft", sentAsDraft: true, targetName: "Vie économique" }
    );
    assert.equal(articles.get("w").status, "publie");
  });

  test("WordPress + parution programmée : refus 409, rien n'est envoyé, l'article n'est pas touché", async () => {
    remettre(); put("p");
    aiguillage.reponse = { mode: "wordpress", target: { id: 7 } };
    const r = await call(A.publish, { params: ["p"], body: { scheduledAt: "2026-11-01T08:00:00Z" } });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /parution programmée n'est pas encore disponible/);
    assert.equal(envoi.appels.length, 0);
    assert.equal(articles.get("p").status, "a_revoir");
  });

  test("programmée en mode simulé : inchangé (le journal simulé accepte la date)", async () => {
    remettre(); put("ps");
    envoi.reponse = { scheduledAt: "2026-11-01T08:00:00.000Z", publishedAt: null, url: "https://simule.test/t", simulated: true };
    const r = await call(A.publish, { params: ["ps"], body: { scheduledAt: "2026-11-01T08:00:00Z" } });
    assert.equal(r.status, 200);
    assert.equal(articles.get("ps").status, "valide");
  });

  test("article déjà envoyé sur WordPress : refus 409 (pas de doublon sur le site)", async () => {
    remettre(); put("d", { publication: { wpId: 321 } });
    aiguillage.reponse = { mode: "wordpress", target: { id: 7 } };
    const r = await call(A.publish, { params: ["d"], body: {} });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /déjà été envoyé sur WordPress \(n° 321\)/);
    assert.equal(envoi.appels.length, 0);
  });

  test("mode WordPress sans cible active : 409 qui dit quoi faire, rien n'est envoyé", async () => {
    remettre(); put("n");
    aiguillage.erreur = Object.assign(new Error("aucune cible active : en créer une dans l'onglet Publication."), { status: 409 });
    const r = await call(A.publish, { params: ["n"], body: {} });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /onglet Publication/);
    assert.equal(envoi.appels.length, 0);
    assert.equal(articles.get("n").status, "a_revoir");
  });

  test("échec côté WordPress : 502 avec le message, l'article reste tel quel", async () => {
    remettre(); put("e");
    aiguillage.reponse = { mode: "wordpress", target: { id: 7 } };
    envoi.erreur = new WpError("WordPress 401 sur POST /wp/v2/posts : Identifiants refusés", { status: 401 });
    const r = await call(A.publish, { params: ["e"], body: {} });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /401/);
    assert.equal(articles.get("e").status, "a_revoir");
    assert.equal(articles.get("e").publication, undefined);
  });
}
