/* M3-109, axe B2 — câblage des Paramètres : routes réelles (src/api/meta.js) et
   yamlStore réel, base simulée par `mock.module`. `npm test` saute ce fichier,
   `npm run test:wiring` le lance (option --experimental-test-module-mocks).

   Vérifie : refus 400 nommé de llm_regen_engines, « revenir au défaut » qui
   SUPPRIME la ligne (instantané + journal), auteur de config_history = la
   personne, détail du journal { clé: { avant, apres } }, droits. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("Paramètres (B2) câblés", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const table = new Map();
  const registre = [];
  let history = [];
  let journalRows = [];
  let deletes = [];

  const q = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/^SELECT key, value FROM settings WHERE key <> \$1/i.test(s)) {
      return { rows: [...table].filter(([k]) => k !== params[0]).map(([key, value]) => ({ key, value })), rowCount: 0 };
    }
    if (/^SELECT key, value FROM settings/i.test(s)) return { rows: [...table].map(([key, value]) => ({ key, value })), rowCount: 0 };
    if (/^SELECT value FROM settings WHERE key = \$1/i.test(s)) return { rows: table.has(params[0]) ? [{ value: table.get(params[0]) }] : [], rowCount: 0 };
    if (/^INSERT INTO settings/i.test(s)) { table.set(params[0], params[1]); return { rows: [], rowCount: 1 }; }
    if (/^DELETE FROM settings WHERE key = ANY/i.test(s)) {
      deletes.push(params[0]);
      for (const k of params[0]) table.delete(k);
      return { rows: [], rowCount: params[0].length };
    }
    if (/^INSERT INTO config_history/i.test(s)) { history.push({ scope: params[0], payload: JSON.parse(params[1]), author: params[2] }); return { rows: [], rowCount: 1 }; }
    if (/FROM llm_providers/i.test(s)) return { rows: registre.map((r) => ({ ...r })), rowCount: 0 };
    if (/^INSERT INTO journal/i.test(s)) {
      journalRows.push({ event: params[2], actorName: params[4], actorRole: params[5], detail: params[7] ? JSON.parse(params[7]) : null });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });

  const M = await import(new URL("api/meta.js", root).href);
  const { requestContext } = await import(new URL("lib/journal.js", root).href);

  const ADMIN = { id: "u1", name: "Alice Admin", login: "alice", role: "administrateur" };
  const call = async (fn, { role = "administrateur", user = ADMIN, body = {} } = {}) => {
    let status = 0, out = null;
    const res = { setHeader() {}, writeHead(c) { status = c; }, end(b) { out = b ? JSON.parse(b) : null; } };
    await requestContext.run({ user, role }, () => fn({ res, role, user, body, params: [], query: {} }));
    return { status, body: out };
  };
  const reset = () => {
    table.clear(); registre.length = 0; history = []; journalRows = []; deletes = [];
    registre.push({ id: "openai", defaultModel: "gpt-4.1", enabled: true }, { id: "openrouter", defaultModel: "openrouter/auto", enabled: true });
  };

  test("GET settings : `stored` ajouté, `settings` et `specs` inchangés", async () => {
    reset();
    table.set("window_hours", "48");
    const r = await call(M.settings);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.stored, ["window_hours"]);
    assert.equal(r.body.settings.window_hours, 48);
    assert.ok(r.body.specs.window_hours);
  });

  test("enregistrer : journal { clé: { avant, apres } }, auteur = la personne, `stored` rendu", async () => {
    reset();
    const r = await call(M.saveSettings, { body: { window_hours: "48" } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.stored, ["window_hours"]);
    assert.equal(history.length, 1);
    assert.equal(history[0].author, "alice (administrateur)");
    assert.equal(journalRows.length, 1);
    assert.equal(journalRows[0].event, "paramètres modifiés");
    assert.equal(journalRows[0].actorName, "Alice Admin");
    assert.deepEqual(journalRows[0].detail, { window_hours: { avant: 72, apres: 48 } });
  });

  test("llm_regen_engines : moteur inconnu → 400 nommé, rien d'écrit", async () => {
    reset();
    const r = await call(M.saveSettings, { body: { llm_regen_engines: "openai, xyz" } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "llm_regen_engines : « xyz » n'est pas un moteur du registre");
    assert.equal(table.has("llm_regen_engines"), false);
    assert.equal(history.length, 0);
  });

  test("llm_regen_engines : routeur → 400 nommé", async () => {
    reset();
    const r = await call(M.saveSettings, { body: { llm_regen_engines: "openrouter" } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /« openrouter » est un routeur .*: modèle variable, exclu des relances/);
  });

  test("llm_regen_engines : valide accepté ; inchangé non recontrôlé (moteur disparu depuis)", async () => {
    reset();
    assert.equal((await call(M.saveSettings, { body: { llm_regen_engines: "openai:gpt-4.1-mini" } })).status, 200);
    assert.equal(table.get("llm_regen_engines"), "openai:gpt-4.1-mini");
    registre.length = 0;
    const r = await call(M.saveSettings, { body: { llm_regen_engines: "openai:gpt-4.1-mini", window_hours: "24" } });
    assert.equal(r.status, 200, "un autre réglage s'enregistre malgré le moteur retiré du registre");
  });

  test("revenir au défaut : la ligne est SUPPRIMÉE, instantané et journal comme une écriture", async () => {
    reset();
    table.set("window_hours", "48");
    table.set("site_icon", "data:image/png;base64,AAAA");
    const r = await call(M.resetSettings, { body: { keys: ["window_hours"] } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.removed, ["window_hours"]);
    assert.deepEqual(r.body.stored, []);
    assert.equal(r.body.settings.window_hours, 72);
    assert.deepEqual(deletes, [["window_hours"]]);
    assert.equal(table.has("window_hours"), false);
    assert.equal(table.has("site_icon"), true, "l'icône n'est pas un réglage");
    assert.equal(history.length, 1);
    assert.equal(history[0].author, "alice (administrateur)");
    assert.equal(history[0].payload.window_hours, "48", "l'état d'avant est gardé");
    assert.equal(journalRows[0].event, "paramètres remis au défaut");
    assert.deepEqual(journalRows[0].detail, { window_hours: { avant: 48, apres: 72 } });
  });

  test("revenir au défaut : réglage déjà au défaut → rien supprimé, ni instantané ni journal", async () => {
    reset();
    const r = await call(M.resetSettings, { body: { key: "window_hours" } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.removed, []);
    assert.equal(history.length, 0);
    assert.equal(journalRows.length, 0);
  });

  test("revenir au défaut : clé inconnue ou corps vide → 400 ; résultat incohérent → refusé", async () => {
    reset();
    assert.equal((await call(M.resetSettings, { body: { keys: ["site_icon"] } })).status, 400);
    assert.equal((await call(M.resetSettings, { body: {} })).status, 400);
    /* signs_max réglé bas : revenir au défaut de h2_above_signs (1500) le dépasserait. */
    table.set("signs_max", "500"); table.set("h2_above_signs", "300"); table.set("breve_signs_min", "200");
    await assert.rejects(call(M.resetSettings, { body: { key: "h2_above_signs" } }), /incohérents/);
    assert.equal(table.get("h2_above_signs"), "300");
  });

  test("droits : mêmes que l'enregistrement (manage_settings)", async () => {
    reset();
    table.set("window_hours", "48");
    const r = await call(M.resetSettings, { role: "relecteur", user: { id: "u2", login: "bob", role: "relecteur" }, body: { key: "window_hours" } });
    assert.equal(r.status, 403);
    assert.equal(table.get("window_hours"), "48");
    assert.equal((await call(M.saveSettings, { role: "super_utilisateur", body: { window_hours: "1" } })).status, 403);
  });
}
