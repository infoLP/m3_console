/* M3-105 — coût des routines, moitié console (T26) : la lecture serveur ne rend
   rien sous le seuil de la FEAT, et lit dans la kv les résumés de routines et le
   registre que le moteur écrit. Le bail « chain » qui écrit ces résumés est
   testé dans M3 (test/wiring/routinesWiring.test.js). Vrais store et
   gestionnaires ; base simulée par `mock.module` : `npm test` saute ce
   fichier, `npm run test:wiring` le lance. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("coût des routines", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const kv = new Map();
  let settings = new Map();
  let reads = [];

  const q = async (sql, params = []) => {
    if (/FROM settings/.test(sql)) return { rows: [...settings].map(([key, value]) => ({ key, value })) };
    if (/INSERT INTO journal/.test(sql)) return { rows: [] };
    if (/^\s*SELECT value FROM kv_documents/.test(sql)) {
      reads.push(params[0]);
      return { rows: kv.has(params[0]) ? [{ value: structuredClone(kv.get(params[0])) }] : [] };
    }
    if (/ON CONFLICT \(key\) DO NOTHING/.test(sql)) { if (!kv.has(params[0])) kv.set(params[0], JSON.parse(sql.match(/'(\[\]|\{.*\})'/)?.[1] ?? params[1] ?? "[]")); return { rows: [] }; }
    if (/INSERT INTO kv_documents|UPDATE kv_documents/.test(sql)) { kv.set(params[0], JSON.parse(params[1])); return { rows: [] }; }
    return { rows: [] };
  };
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  mock.module(new URL("lib/log.js", root).href, {
    namedExports: { log: { info() {}, warn() {}, error() {} }, addLogSink() {}, cleanFields: (x) => x },
  });

  const store = await import(new URL("lib/store.js", root).href);
  const { coutRoutines } = await import(new URL("consulterCoutRoutines/coutRoutines.api.js", root).href);
  const ops = await import(new URL("api/ops.js", root).href);
  const { KV_PLANIFICATION, KV_DEPENSES_LLM, periodKeys } = await import(new URL("../shared/contrat.js", root).href);

  const reset = (s = {}) => { kv.clear(); settings = new Map(Object.entries(s)); reads = []; };
  const usage = (cost, totalTokens = 1000) => ({ promptTokens: 0, completionTokens: 0, totalTokens, cost, billedCalls: 3, uncounted: 0 });
  const appel = async (fn, ctx) => { let out; await fn({ ...ctx, res: { writeHead() {}, end(b) { out = JSON.parse(b); } } }); return out; };
  /* Résumé tel que le moteur l'écrit à la sortie du bail (resumeRoutine, M3). */
  const routine = ({ origine = "manuelle", items = null, crees = 0, cout = null, tokens = 0 } = {}) => store.pushCollection("routines", {
    id: `rt-${Math.random()}`, origine, owner: null, at: new Date().toISOString(), fin: new Date().toISOString(), statut: "ok", erreur: null,
    recolte: items == null ? null : { items, cout: null },
    generation: crees || tokens ? { crees, cout, tokens, appels: 3, moteur: "openrouter", plafond: null } : null,
  });

  test("lecture serveur : FEAT fermée au rôle → null, la collection n'est pas lue", async () => {
    reset();
    await routine({ crees: 2, cout: 0.01, tokens: 1000 });
    reads = [];
    assert.equal(await appel(coutRoutines, { role: "relecteur" }), null, "défaut administrateur : fermée au relecteur");
    assert.equal(await appel(coutRoutines, { role: "super_utilisateur" }), null, "défaut administrateur (R10) : fermée au super utilisateur");
    assert.ok(!reads.some((k) => k.endsWith("routines.json")), "rien n'est lu, donc rien ne peut partir");
    settings.set("feat_cout_routines_min_role", "aucun");
    assert.equal(await appel(coutRoutines, { role: "administrateur" }), null, "« aucun » ferme à tous");
  });

  test("lecture serveur : FEAT ouverte → routines, totaux du jour et du mois, registre", async () => {
    reset();
    await routine({ origine: "planifiee", crees: 3, cout: 0.03, tokens: 1000 });
    await routine({ items: 5 });
    kv.set("llm/spend.json", { days: {}, months: {} });
    const out = await appel(coutRoutines, { role: "administrateur" });
    assert.equal(out.routines.length, 2);
    assert.equal(out.routines[0].generation, null, "la plus récente en tête : la récolte seule");
    assert.equal(out.totaux.jour.routines, 2);
    assert.equal(out.totaux.jour.articles, 3);
    assert.ok(Math.abs(out.totaux.mois.cout - 0.03) < 1e-9);
    assert.deepEqual(out.registre.jour, { cout: 0, tokens: 0 });
    assert.equal(out.conservees, 2);
  });

  /* Panneau « Dernière récupération » (ops.lastRun) : les montants en dollars
     suivent la même FEAT. Usage, plafond en $ et message d'erreur qui le cite. */
  const plafond = { scope: "run", unit: "usd", used: 0.52, cap: 0.5, detail: "plafond par run atteint : 0,52 $ dépensés pour 0,5 $ autorisés" };
  const semerRuns = async () => {
    await store.pushCollection("runs", { id: "g1", kind: "generation", at: new Date().toISOString(),
      stats: { created: 2, provider: "openrouter", usage: usage(0.0832, 41000), cap: plafond, llmError: "Génération interrompue — " + plafond.detail + "." } });
  };

  test("Dernière récupération, FEAT sur « aucun » : aucun coût dans la réponse, tokens gardés", async () => {
    reset({ feat_cout_routines_min_role: "aucun" });
    await semerRuns();
    const out = await appel(ops.lastRun, { role: "administrateur" });
    const json = JSON.stringify(out);
    assert.ok(!/"cost"/.test(json), "aucun champ cost");
    assert.ok(!/\d\s?\$/.test(json), "aucun montant en dollars, même dans un texte : " + json.match(/.{30}\$.{10}/)?.[0]);
    assert.ok(!/"used"|"cap":0/.test(json), "plafond en $ sans montants");
    const g = out.runs[0].stats;
    assert.equal(g.usage.totalTokens, 41000, "les tokens restent");
    assert.equal(g.created, 2, "les compteurs restent");
    assert.match(g.cap.detail, /\[montant masqué\]/);
  });

  test("Dernière récupération, FEAT ouverte au rôle : les coûts restent", async () => {
    reset();
    await semerRuns();
    const out = await appel(ops.lastRun, { role: "administrateur" });
    assert.equal(out.runs[0].stats.usage.cost, 0.0832);
    assert.equal(out.runs[0].stats.cap.used, 0.52);
    const fermee = await appel(ops.lastRun, { role: "relecteur" });
    assert.equal(fermee.runs[0].stats.usage.cost, undefined, "défaut administrateur : masqué au relecteur");
    assert.equal((await appel(ops.lastRun, { role: "super_utilisateur" })).runs[0].stats.usage.cost, undefined, "et au super utilisateur");
  });

  /* T24 : la console ne lit plus le moteur, mais la kv qu'il écrit
     (KV_PLANIFICATION, KV_DEPENSES_LLM du contrat). */
  test("planification : réglages de la console, état d'exécution lu dans la kv du moteur", async () => {
    reset({ schedule_enabled: "oui", schedule_times: "06:30, 18:00" });
    const lastRunMoteur = { slot: "2026-10-28 06:30", harvest: { items: 4 }, generation: { created: 2 } };
    kv.set(KV_PLANIFICATION, { lastSlot: "2026-10-28 06:30", running: null, lastRun: lastRunMoteur });
    const s = await ops.scheduleStatus(Date.parse("2026-10-28T10:00:00Z"));
    assert.equal(s.enabled, true);
    assert.deepEqual(s.times, ["06:30", "18:00"]);
    assert.equal(s.error, null);
    assert.ok(s.next, "prochain créneau calculé côté console");
    assert.equal(s.lastSlot, "2026-10-28 06:30");
    assert.deepEqual(s.lastRun, lastRunMoteur);
    assert.ok(reads.includes(KV_PLANIFICATION));
    const out = await appel(ops.lastRun, { role: "administrateur" });
    assert.deepEqual(out.schedule.lastRun, lastRunMoteur);
  });

  test("planification coupée, kv vide : rien d'inventé", async () => {
    reset();
    const s = await ops.scheduleStatus();
    assert.equal(s.enabled, false);
    assert.equal(s.next, null);
    assert.equal(s.lastRun, null);
  });

  test("coût des routines : le registre du moteur est lu dans la kv, à la tranche du jour", async () => {
    reset({ feat_cout_routines_min_role: "relecteur" });
    const now = Date.parse("2026-10-28T10:00:00Z");
    const { day, month } = periodKeys(now);
    kv.set(KV_DEPENSES_LLM, { days: { [day]: { cost: 0.12, totalTokens: 900 } }, months: { [month]: { cost: 1.5, totalTokens: 12000 } } });
    const out = await appel((ctx) => coutRoutines({ ...ctx, now }), { role: "administrateur" });
    assert.deepEqual(out.registre, { jour: { cout: 0.12, tokens: 900 }, mois: { cout: 1.5, tokens: 12000 } });
  });
}
