/* Journal des connexions : nom, rôle et identifiant COMPLET pour un compte connu
   (demande du 2026-10-13 : la colonne « Qui » restait vide et l'identifiant
   tronqué). Base simulée par `mock.module` : `npm test` saute ce fichier,
   `npm run test:wiring` le lance. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("journal des connexions", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const inserts = [];
  const q = async (sql, params) => {
    if (/INSERT INTO journal/i.test(sql)) inserts.push(params);
    return { rows: [], rowCount: 0 };
  };
  mock.module(new URL("../../src/lib/db.js", import.meta.url).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  const J = await import("../../src/lib/journal.js");
  const { log } = await import("../../src/lib/log.js");
  J.startJournal();
  // colonnes de l'INSERT : category, level, event, actor_id, actor_name, actor_role, target, detail
  const row = (p) => ({ category: p[0], event: p[2], id: p[3], name: p[4], role: p[5], target: p[6] });
  const u = { id: "u1", name: "Alexandre Sanchez", login: "a.sanchez@legalprime.fr", role: "administrateur" };

  test("connexion : qui (nom, rôle) et identifiant complet", () => {
    inserts.length = 0;
    J.journalCompte("connexion sso", u, { user: u });
    assert.equal(inserts.length, 1);
    assert.deepEqual(row(inserts[0]), { category: "connexion", event: "connexion sso", id: "u1", name: "Alexandre Sanchez", role: "administrateur", target: "a.sanchez@legalprime.fr" });
  });

  test("compte sans nom : l'identifiant le remplace dans « Qui »", () => {
    inserts.length = 0;
    J.journalCompte("connexion", { ...u, name: null }, { user: { ...u, name: null } });
    assert.equal(row(inserts[0]).name, "a.sanchez@legalprime.fr");
  });

  test("la ligne tronquée du fichier de logs n'est pas relayée en double", () => {
    inserts.length = 0;
    for (const m of ["connexion", "connexion sso", "déconnexion", "sso rattachement initial", "mot de passe changé"])
      log.info("auth", m, { login: "a.sa…@legalprime.fr" });
    assert.equal(inserts.length, 0);
    // un refus, lui, passe toujours par le relais, identifiant tronqué
    log.warn("auth", "refus", { login: "x.y…@exemple.fr", motif: "compte_introuvable" });
    assert.equal(inserts.length, 1);
    assert.equal(row(inserts[0]).target, "x.y…@exemple.fr");
  });

  test("mot de passe attribué : l'auteur reste celui de la requête, le compte visé en cible", () => {
    inserts.length = 0;
    J.requestContext.run({ user: { id: "a1", name: "Admin" }, role: "administrateur" }, () =>
      J.journalCompte("mot de passe attribué par l'administrateur", { login: "n.t@legalprime.fr" }));
    const r = row(inserts[0]);
    assert.equal(r.name, "Admin"); assert.equal(r.target, "n.t@legalprime.fr");
  });
}
