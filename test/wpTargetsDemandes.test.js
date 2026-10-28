/* T22c — onglet Publication : le mode de publication et la configuration
   M3_WP_* sont ceux du MOTEUR, lus dans moteur/etat (R8) ; « Tester la
   connexion » est une demande test_wp_target au moteur. Demandes, cibles et
   réponse simulées par `mock.module` : ni base ni réseau. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("cibles WordPress : demandes au moteur", { skip: "lancer `npm test` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../src/", import.meta.url);
  const deposees = [];
  let etat = {};
  let fin = {};
  mock.module(new URL("lib/demandes.js", root).href, {
    namedExports: {
      enqueue: async (kind, params, user) => { deposees.push({ kind, params, par: user?.login ?? null }); return { id: 7 }; },
      attendreJob: async (id) => ({ id, finishedAt: "2026-10-28T15:00:00Z", ...fin }),
      lireEtatMoteur: async () => etat,
    },
  });
  mock.module(new URL("lib/wpTargets.js", root).href, {
    namedExports: { createWpTargets: () => ({ list: async () => [{ id: 1, name: "Site" }] }) },
  });
  mock.module(new URL("lib/yamlStore.js", root).href, { namedExports: { readSettings: async () => ({ wp_target: "demo" }) } });
  mock.module(new URL("lib/secretBox.js", root).href, { namedExports: { secretsAvailable: () => true } });
  mock.module(new URL("lib/journal.js", root).href, { namedExports: { journal: () => {} } });
  mock.module(new URL("lib/http.js", root).href, {
    namedExports: { send: (res, status, body) => { res.status = status; res.body = body; } },
  });
  const { targetsList, targetTest } = await import(new URL("api/wpTargets.js", root).href);
  const appel = async (h, ctx = {}) => { const res = {}; await h({ res, role: "administrateur", user: { login: "admin@ex.fr" }, params: [], ...ctx }); return res; };
  test.beforeEach(() => { deposees.length = 0; etat = {}; fin = {}; });

  test("liste : mode et configuration lus dans moteur/etat, pas dans l'environnement de la console", async () => {
    etat = { vivant: true, publication: { mode: "wordpress", envConfigured: true } };
    const r = await appel(targetsList);
    assert.equal(r.status, 200);
    assert.equal(r.body.moteurVivant, true);
    assert.equal(r.body.mode, "wordpress");
    assert.equal(r.body.envConfigured, true);
    assert.equal(r.body.simulatedTarget, "demo");
  });

  test("liste : moteur arrêté → mode inconnu (null), jamais un mode périmé", async () => {
    etat = { vivant: false, publication: { mode: "wordpress", envConfigured: true } };
    const r = await appel(targetsList);
    assert.equal(r.body.moteurVivant, false);
    assert.equal(r.body.mode, null);
    assert.equal(r.body.envConfigured, false);
  });

  test("tester : demande test_wp_target, verdict rendu tel quel", async () => {
    fin = { result: { ok: true, name: "Rédac", roles: ["editor"], canPost: true, message: "Connecté : Rédac (editor)." } };
    const r = await appel(targetTest, { params: ["3"] });
    assert.deepEqual(deposees, [{ kind: "test_wp_target", params: { targetId: "3" }, par: "admin@ex.fr" }]);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  test("tester : cible inconnue côté moteur → 404, autre échec → 502", async () => {
    fin = { error: "cible inconnue : 9" };
    assert.equal((await appel(targetTest, { params: ["9"] })).status, 404);
    fin = { error: "délai dépassé : « test_wp_target » sans réponse après 60 s" };
    assert.equal((await appel(targetTest, { params: ["3"] })).status, 502);
  });
}
