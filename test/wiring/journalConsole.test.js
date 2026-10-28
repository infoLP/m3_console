/* Journal des actions de la console (M3-96) : validation, signalement,
   archivage, parution, régénération, édition. Base simulée par `mock.module` :
   `npm test` saute ce fichier, la commande avec --experimental-test-module-mocks
   (`npm run test:wiring`) le lance. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("journal des actions de la console", { skip: "lancer avec --experimental-test-module-mocks (npm run test:wiring)" }, () => {});
} else {
  const inserts = [];
  const q = async (sql, params) => {
    if (/INSERT INTO journal/i.test(sql)) inserts.push(params);
    return { rows: [], rowCount: 0 };
  };
  mock.module(new URL("../../src/lib/db.js", import.meta.url).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  /* Deux instances du module : `web` n'appelle jamais startJournal(), comme le
     processus Next.js ; `J` est démarrée, comme le worker. */
  const web = await import("../../src/lib/journal.js?web");
  const J = await import("../../src/lib/journal.js");
  J.startJournal();
  // colonnes de l'INSERT : category, level, event, actor_id, actor_name, actor_role, target, detail
  const row = (p) => ({ category: p[0], event: p[2], id: p[3], name: p[4], role: p[5], target: p[6], detail: p[7] && JSON.parse(p[7]) });
  const u = { id: "u1", name: "Claire Relectrice", login: "c.r@legalprime.fr", role: "relecteur" };
  const article = { id: "a1", title: "La digue de Châtelaillon rouvre" };

  test("parution : catégorie action, auteur passé, titre en cible, origine console", () => {
    inserts.length = 0;
    const r = { ok: true, data: { article, publication: {} } };
    assert.equal(J.journalConsole("parution", r, { user: u }), r, "la valeur reçue est rendue telle quelle");
    assert.equal(inserts.length, 1);
    assert.deepEqual(row(inserts[0]), {
      category: "action", event: "parution", id: "u1", name: "Claire Relectrice", role: "relecteur",
      target: "La digue de Châtelaillon rouvre", detail: { origine: "console", article: "a1" },
    });
  });

  test("une action refusée (Resultat en échec) n'est pas journalisée", () => {
    inserts.length = 0;
    const r = { ok: false, erreur: "droit de publication requis", status: 403 };
    assert.equal(J.journalConsole("parution", r, { user: u }), r);
    assert.equal(inserts.length, 0);
  });

  test("le web, sans startJournal(), écrit pendant une requête ou avec un auteur explicite — jamais sinon", () => {
    inserts.length = 0;
    web.journal("action", "hors requête");
    assert.equal(inserts.length, 0, "outil en ligne de commande : rien");
    web.requestContext.run({ user: { id: "a9", name: "Admin" }, role: "administrateur" }, () => web.journal("action", "sources enregistrées"));
    assert.equal(inserts.length, 1);
    assert.equal(row(inserts[0]).name, "Admin");
    web.journalConsole("régénération", { ok: true, data: article }, { user: u, detail: { force: false } });
    assert.equal(inserts.length, 2, "action serveur, après le handler : l'auteur passé suffit");
    assert.deepEqual(row(inserts[1]).detail, { origine: "console", article: "a1", force: false });
  });

  test("changement de statut (run « status ») : nommé par le statut, auteur de la requête", () => {
    inserts.length = 0;
    const ctx = { user: { id: "u1", name: "Claire Relectrice" }, role: "relecteur" };
    for (const status of ["valide", "signale", "archive", "publie", "a_revoir"])
      J.requestContext.run(ctx, () => J.journalRun({ kind: "status", stats: { article: "a1", status, role: "relecteur" } }));
    assert.deepEqual(inserts.map((p) => row(p).event), ["validation", "signalement", "archivage", "parution", "remise en relecture"]);
    const r = row(inserts[0]);
    assert.equal(r.category, "action"); assert.equal(r.name, "Claire Relectrice"); assert.equal(r.target, "a1");
    assert.equal(r.detail.origine, "console"); assert.equal(r.detail.statut, "valide");
  });

  test("édition : une ligne par personne et par article sur la fenêtre, pas une par saisie", () => {
    inserts.length = 0;
    const t0 = Date.parse("2026-10-14T10:00:00Z");
    const ok = (a) => ({ ok: true, data: a });
    J.journalConsole("édition", ok(article), { user: u, now: t0, detail: { champs: ["body"] } });
    J.journalConsole("édition", ok(article), { user: u, now: t0 + 5000, detail: { champs: ["body"] } });
    J.journalConsole("édition", ok(article), { user: u, now: t0 + J.EDITION_FENETRE_MS - 1 });
    assert.equal(inserts.length, 1);
    assert.deepEqual(row(inserts[0]).detail, { origine: "console", article: "a1", champs: ["body"] });
    J.journalConsole("édition", ok({ id: "a2", title: "Autre" }), { user: u, now: t0 + 6000 });
    J.journalConsole("édition", ok(article), { user: { ...u, id: "u2" }, now: t0 + 7000 });
    assert.equal(inserts.length, 3, "autre article, autre personne : journalisés");
    J.journalConsole("édition", ok(article), { user: u, now: t0 + J.EDITION_FENETRE_MS + 1 });
    assert.equal(inserts.length, 4, "fenêtre passée : de nouveau journalisée");
  });
}
