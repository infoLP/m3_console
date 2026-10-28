/* M3-92, M3-93 — les FEAT qui ouvrent un droit sont tenues par le serveur, pas
   seulement par l'écran. Routes réelles (src/api/articles.js, src/api/meta.js),
   base simulée par `mock.module` : `npm test` saute ce fichier, `npm run
   test:wiring` le lance (option --experimental-test-module-mocks). */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("FEAT tenues par le serveur", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const articles = new Map();
  const tickets = [];
  const notifications = [];
  let settings = {};
  /* T19c (R10) : la route publish dépose une demande « publish » au moteur et
     répond 202, elle ne publie plus elle-même. */
  const deposes = [];
  const publiees = () => deposes.filter((d) => d.kind === "publish").length;
  let historyArgs = null;

  const noop = async () => null;
  mock.module(new URL("lib/store.js", root).href, {
    namedExports: {
      readArticle: async (id) => structuredClone(articles.get(id) || null),
      writeArticle: async (a) => { articles.set(a.id, structuredClone(a)); },
      ROOT: ".", dataPath: (...p) => p.join("/"), readJson: noop, writeJson: noop,
      readCollection: async (name) => (name === "notifications" ? structuredClone(notifications) : []), writeCollection: noop, filterCollection: async () => 0,
      pushCollection: async (name, item) => { if (name === "tickets") tickets.push(item); },
      listArticleIds: async () => [], clearArticles: async () => ({}), clearAllData: noop,
      INDEX_LIMIT_DEFAULT: 100, INDEX_LIMIT_MAX: 500, readIndex: async () => ({}),
      HISTORY_STATUSES: [], HISTORY_LIMIT_DEFAULT: 50,
      readHistory: async (args) => { historyArgs = args; return { items: [], total: 0, counts: {}, nextCursor: null }; },
    },
  });
  /* La table settings répond avec les réglages du test ; tout le reste est vide. */
  const q = async (sql) => /FROM settings/i.test(sql)
    ? { rows: Object.entries(settings).map(([key, value]) => ({ key, value })), rowCount: 0 }
    : { rows: [], rowCount: 0 };
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  mock.module(new URL("lib/demandes.js", root).href, {
    namedExports: {
      enqueue: async (kind, params) => { deposes.push({ kind, params }); return { id: deposes.length, kind, duplicate: false }; },
      attendreJob: async () => ({ result: null, error: null }),
    },
  });

  const A = await import(new URL("api/articles.js", root).href);
  const M = await import(new URL("api/meta.js", root).href);
  const call = async (fn, ctx) => {
    let status = 0, body = null;
    const res = { setHeader() {}, writeHead(c) { status = c; }, end(b) { body = b ? JSON.parse(b) : null; } };
    await fn({ res, role: "relecteur", user: { id: "u1", name: "Relecteur Un", login: "r1" }, body: {}, params: [], ...ctx });
    return { status, body };
  };
  const put = (id, illustration) => articles.set(id, { id, status: "a_revoir", provider: "openrouter", title: "t", chapo: "", body: [], zone: {}, seo: {}, illustration });

  test("M3-93 — par défaut, personne n'est obligé d'avoir une image", async () => {
    settings = {}; deposes.length = 0;
    put("a", null);
    const r = await call(A.publish, { params: ["a"] });
    assert.equal(r.status, 202); assert.equal(publiees(), 1);
  });

  test("M3-93 — sous le seuil : parution et validation refusées sans URL d'image", async () => {
    settings = { feat_sans_illustration_min_role: "super_utilisateur" }; deposes.length = 0;
    put("b", { url: "", credit: "" });
    let r = await call(A.publish, { params: ["b"] });
    assert.equal(r.status, 409); assert.equal(r.body.code, "illustration"); assert.equal(publiees(), 0);
    for (const status of ["valide", "publie"]) {
      r = await call(A.setStatus, { params: ["b"], body: { status } });
      assert.equal(r.status, 409, status); assert.equal(r.body.code, "illustration", status);
    }
    r = await call(A.setStatus, { params: ["b"], body: { status: "archive" } });
    assert.equal(r.status, 200, "classer sans diffusion reste possible");
  });

  test("M3-93 — au-dessus du seuil, ou avec une image : parution acceptée", async () => {
    settings = { feat_sans_illustration_min_role: "super_utilisateur" }; deposes.length = 0;
    put("c", null);
    let r = await call(A.publish, { params: ["c"], role: "super_utilisateur" });
    assert.equal(r.status, 202);
    put("d", { url: "https://exemple.fr/i.jpg", credit: "©" });
    r = await call(A.publish, { params: ["d"] });
    assert.equal(r.status, 202); assert.equal(publiees(), 2);
  });

  test("M3-93 — « aucun » : même l'administrateur doit poser une image ; au-dessus du seuil, la validation passe", async () => {
    settings = { feat_sans_illustration_min_role: "aucun" };
    put("e", null);
    let r = await call(A.publish, { params: ["e"], role: "administrateur" });
    assert.equal(r.status, 409); assert.equal(r.body.code, "illustration");
    settings = { feat_sans_illustration_min_role: "super_utilisateur" };
    r = await call(A.setStatus, { params: ["e"], body: { status: "valide" }, role: "super_utilisateur" });
    assert.equal(r.status, 200);
  });

  /* Relecture adverse : un article validé (parution programmée) perdait son image
     par PATCH, puis publishDue le publiait sans revérifier. */
  test("M3-93 — un article validé ne perd pas son image sous le seuil", async () => {
    settings = { feat_sans_illustration_min_role: "super_utilisateur" };
    articles.set("f", { id: "f", status: "valide", provider: "openrouter", title: "t", chapo: "", body: [], zone: {}, seo: {},
      illustration: { url: "https://exemple.fr/i.jpg" }, publication: { scheduledAt: "2099-01-01T00:00:00Z" } });
    let r = await call(A.patch, { params: ["f"], body: { illustration: null } });
    assert.equal(r.status, 409); assert.equal(r.body.code, "illustration");
    assert.ok(articles.get("f").illustration, "l'image est restée");
    r = await call(A.patch, { params: ["f"], body: { illustration: { url: "" } } });
    assert.equal(r.status, 409);
    r = await call(A.patch, { params: ["f"], body: { title: "nouveau titre" } });
    assert.equal(r.status, 200, "le reste reste modifiable");
    r = await call(A.patch, { params: ["f"], body: { illustration: null }, role: "super_utilisateur" });
    assert.equal(r.status, 200, "au-dessus du seuil, retirer l'image est permis");
  });

  /* M3-97 : `role` est le rôle effectif — un administrateur en « Voir comme
     relecteur » arrive ici en relecteur, et reçoit la même réponse. */
  test("M3-97 — l'Historique ne lit les purgés qu'au-dessus du seuil", async () => {
    settings = {};
    for (const [role, voit] of [["relecteur", false], ["super_utilisateur", true], ["administrateur", true]]) {
      const r = await call(A.history, { role, query: { category: "purge" } });
      assert.equal(r.status, 200, role);
      assert.equal(historyArgs.withPurged, voit, role);
      assert.equal(r.body.canSeePurged, voit, role);
    }
    settings = { feat_historique_purges_min_role: "relecteur" };
    let r = await call(A.history, { query: {} });
    assert.equal(historyArgs.withPurged, true); assert.equal(r.body.canSeePurged, true);
    settings = { feat_historique_purges_min_role: "aucun" };
    r = await call(A.history, { role: "administrateur", query: {} });
    assert.equal(historyArgs.withPurged, false); assert.equal(r.body.canSeePurged, false);
  });

  /* M3-121, M3-122 : la notification des nouveaux candidats est filtrée par la
     route, pas par l'écran ; les autres notifications passent pour tous. */
  test("M3-122 — nouveaux candidats : envoyés à l'administrateur et au super utilisateur, pas au relecteur", async () => {
    settings = {};
    notifications.splice(0, notifications.length,
      { id: "n1", type: "competitors_candidates", read: false },
      { id: "n2", type: "llm_secours", read: false });
    const ids = async (role) => (await call(M.notifications, { role })).body.notifications.map((n) => n.id);
    assert.deepEqual(await ids("administrateur"), ["n1", "n2"]);
    assert.deepEqual(await ids("super_utilisateur"), ["n1", "n2"]);
    assert.deepEqual(await ids("relecteur"), ["n2"]);
    settings = { feat_notif_concurrents: "aucun" };
    assert.deepEqual(await ids("administrateur"), ["n2"]);
    notifications.length = 0; settings = {};
  });

  test("M3-92 — demande refusée quand la FEAT est fermée au rôle", async () => {
    settings = { feat_demande_source_min_role: "super_utilisateur" }; tickets.length = 0;
    const r = await call(M.createTicket, { body: { name: "Mairie", url: "https://mairie.fr" } });
    assert.equal(r.status, 403); assert.equal(tickets.length, 0);
  });

  test("M3-92 — demande complète : champs de source gardés, auteur pris de la session", async () => {
    settings = {}; tickets.length = 0;
    const r = await call(M.createTicket, { body: {
      name: "Mairie de Rochefort", url: "https://rochefort.fr/actu", organisation: "Mairie de Rochefort",
      sourceKind: "public", type: "rss", commune: "Rochefort", scopeLevel: "commune", dept: "17",
      category: "Société", frequency: "hebdomadaire", note: "Communiqués", requestedBy: "Administrateur",
    } });
    assert.equal(r.status, 201);
    const t = tickets[0];
    assert.equal(t.label, "Mairie de Rochefort");
    assert.equal(t.type, "rss"); assert.equal(t.sourceKind, "public"); assert.equal(t.scopeLevel, "commune");
    assert.equal(t.dept, "17"); assert.equal(t.region, undefined);
    assert.equal(t.frequency, "hebdomadaire"); assert.equal(t.category, "Société");
    assert.equal(t.requestedBy, "Relecteur Un", "le corps ne choisit pas l'auteur");
  });

  test("M3-92 — valeurs inconnues écartées, nom et adresse exigés", async () => {
    settings = {}; tickets.length = 0;
    let r = await call(M.createTicket, { body: { name: "X", url: "https://x.fr", type: "ftp", sourceKind: "secret", scopeLevel: "monde", dept: "999" } });
    assert.equal(r.status, 201);
    const t = tickets[0];
    for (const k of ["type", "sourceKind", "scopeLevel", "dept", "region"]) assert.equal(t[k], undefined, k);
    // clés héritées du prototype et valeurs non chaînes (relecture adverse)
    tickets.length = 0;
    r = await call(M.createTicket, { body: { name: "X", url: "https://x.fr", scopeLevel: "constructor", region: "toString", type: ["rss"] } });
    assert.equal(r.status, 201);
    for (const k of ["type", "scopeLevel", "region"]) assert.equal(tickets[0][k], undefined, k);
    tickets.length = 0;
    r = await call(M.createTicket, { body: { name: "X", url: "https://x.fr", dept: ["17"], region: ["75"] } });
    assert.equal(tickets[0].dept, undefined); assert.equal(tickets[0].region, undefined);
    r = await call(M.createTicket, { body: { name: "X" } });
    assert.equal(r.status, 400);
    r = await call(M.createTicket, { body: { name: "X", url: "javascript:alert(1)" } });
    assert.equal(r.status, 400);
  });
}
