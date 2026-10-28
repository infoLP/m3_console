/* M3-105 — coût des routines : le bail « chain » ouvre une routine, les runs
   écrits pendant qu'elle le tient y sont rangés, son résumé part dans la
   collection « routines » ; la lecture serveur ne rend rien sous le seuil de la
   FEAT. Vrais runLock, store et gestionnaire ; base simulée par `mock.module` :
   `npm test` saute ce fichier, `npm run test:wiring` le lance. */

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
    if (/RETURNING key/.test(sql)) { // runLock.acquire
      const cur = kv.get(params[0]);
      if (cur && Date.parse(cur.expiresAt) > Date.now()) return { rows: [] };
      kv.set(params[0], JSON.parse(params[1]));
      return { rows: [{ key: params[0] }] };
    }
    if (/ON CONFLICT \(key\) DO NOTHING/.test(sql)) { if (!kv.has(params[0])) kv.set(params[0], JSON.parse(sql.match(/'(\[\]|\{.*\})'/)?.[1] ?? params[1] ?? "[]")); return { rows: [] }; }
    if (/INSERT INTO kv_documents|UPDATE kv_documents/.test(sql)) { kv.set(params[0], JSON.parse(params[1])); return { rows: [] }; }
    if (/DELETE FROM kv_documents/.test(sql)) {
      const cur = kv.get(params[0]);
      if (cur && (!/token/.test(sql) || cur.token === params[1])) { kv.delete(params[0]); return { rows: [{ value: cur }] }; }
      return { rows: [] };
    }
    return { rows: [] };
  };
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  mock.module(new URL("lib/log.js", root).href, {
    namedExports: { log: { info() {}, warn() {}, error() {} }, addLogSink() {}, cleanFields: (x) => x },
  });

  /* Ordonnanceur réel (M3-105, routine « partielle ») : récolte et génération
     simulées, la récolte échoue sur demande. */
  let recolteEchoue = false;
  mock.module(new URL("ingest/harvestRun.js", root).href, {
    namedExports: { runHarvest: async () => { if (recolteEchoue) throw new Error("base injoignable"); return { stats: { items: 1 } }; } },
  });
  mock.module(new URL("generate/pipeline.js", root).href, {
    namedExports: { runGeneration: async () => ({ created: [], skipped: [], candidates: 0, provider: "mock" }) },
  });

  const { withLock } = await import(new URL("lib/runLock.js", root).href);
  const { runChain } = await import(new URL("schedule/scheduler.js", root).href);
  const store = await import(new URL("lib/store.js", root).href);
  const { coutRoutines } = await import(new URL("consulterCoutRoutines/coutRoutines.api.js", root).href);
  const ops = await import(new URL("api/ops.js", root).href);

  const routines = () => store.readCollection("routines");
  const reset = (s = {}) => { kv.clear(); settings = new Map(Object.entries(s)); reads = []; };
  const genRun = (usage, created = 2) => store.pushCollection("runs", { id: `g-${Math.random()}`, kind: "generation", at: new Date().toISOString(), stats: { created, provider: "openrouter", usage } });
  const harvestRun = (items = 7) => store.pushCollection("runs", { id: `h-${Math.random()}`, kind: "harvest", at: new Date().toISOString(), stats: { items } });
  const usage = (cost, totalTokens = 1000) => ({ promptTokens: 0, completionTokens: 0, totalTokens, cost, billedCalls: 3, uncounted: 0 });
  const appel = async (fn, ctx) => { let out; await fn({ ...ctx, res: { writeHead() {}, end(b) { out = JSON.parse(b); } } }); return out; };

  test("routine planifiée : runs étiquetés, résumé récolte « — » + génération en $", async () => {
    reset();
    await withLock("chain", "planification 06:30", async () => { await harvestRun(7); await genRun(usage(0.042), 3); }, { routine: "planifiee" });
    const [r] = await routines();
    assert.equal(r.origine, "planifiee");
    assert.equal(r.statut, "ok");
    assert.deepEqual(r.recolte, { items: 7, cout: null });
    assert.equal(r.generation.crees, 3);
    assert.equal(r.generation.cout, 0.042);
    assert.equal(r.generation.tokens, 1000);
    const runs = await store.readCollection("runs");
    assert.ok(runs.every((x) => x.routine === r.id), "chaque run porte l'identifiant de sa routine");
  });

  test("hors bail : un run n'est pas étiqueté et ne fait pas de routine", async () => {
    reset();
    await store.pushCollection("runs", { id: "s1", kind: "status", stats: {} });
    assert.equal((await store.readCollection("runs"))[0].routine, undefined);
    assert.deepEqual(await routines(), []);
  });

  test("récolte seule, origine par défaut « manuelle » (demande du back-office)", async () => {
    reset();
    await withLock("chain", "récolte manuelle (Camille)", async () => { await harvestRun(4); });
    const [r] = await routines();
    assert.equal(r.origine, "manuelle");
    assert.equal(r.generation, null);
    assert.equal(r.recolte.items, 4);
  });

  test("échec en cours de routine : résumé écrit quand même, statut échec, bail rendu", async () => {
    reset();
    await assert.rejects(withLock("chain", "npm run daily (poste)", async () => { await harvestRun(2); throw new Error("base injoignable"); }, { origin: "cli", routine: "daily" }), /base injoignable/);
    const [r] = await routines();
    assert.deepEqual([r.origine, r.statut, r.erreur], ["daily", "echec", "base injoignable"]);
    assert.equal([...kv.keys()].some((k) => k === "locks/chain.json"), false);
  });

  test("bail déjà tenu : refus, aucune routine enregistrée", async () => {
    reset();
    await withLock("chain", "planification", async () => {
      await assert.rejects(withLock("chain", "génération manuelle", async () => {}), /déjà en cours/);
    }, { routine: "planifiee" });
    assert.equal((await routines()).length, 1);
  });

  test("routine planifiée dont la récolte échoue : « partielle », motif court, pas « ok »", async () => {
    reset();
    recolteEchoue = true;
    try { await runChain("2026-10-15 06:30"); } finally { recolteEchoue = false; }
    const [r] = await routines();
    assert.equal(r.origine, "planifiee");
    assert.equal(r.statut, "partielle");
    assert.equal(r.erreur, "récolte en échec : base injoignable");
    assert.equal(r.generation, null, "la génération n'a pas été lancée");
  });

  test("moteur sans coût : cout null, tokens gardés", async () => {
    reset();
    await withLock("chain", "génération manuelle", async () => { await genRun(usage(null, 5000), 2); });
    const [r] = await routines();
    assert.equal(r.generation.cout, null);
    assert.equal(r.generation.tokens, 5000);
  });

  test("lecture serveur : FEAT fermée au rôle → null, la collection n'est pas lue", async () => {
    reset();
    await withLock("chain", "x", async () => { await genRun(usage(0.01)); });
    reads = [];
    assert.equal(await appel(coutRoutines, { role: "relecteur" }), null, "défaut administrateur : fermée au relecteur");
    assert.equal(await appel(coutRoutines, { role: "super_utilisateur" }), null, "défaut administrateur (R10) : fermée au super utilisateur");
    assert.ok(!reads.some((k) => k.endsWith("routines.json")), "rien n'est lu, donc rien ne peut partir");
    settings.set("feat_cout_routines_min_role", "aucun");
    assert.equal(await appel(coutRoutines, { role: "administrateur" }), null, "« aucun » ferme à tous");
  });

  test("lecture serveur : FEAT ouverte → routines, totaux du jour et du mois, registre", async () => {
    reset();
    await withLock("chain", "a", async () => { await genRun(usage(0.03), 3); }, { routine: "planifiee" });
    await withLock("chain", "b", async () => { await harvestRun(5); });
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
    assert.ok(!/ds?$/.test(json), "aucun montant en dollars, même dans un texte : " + json.match(/.{30}$.{10}/)?.[0]);
    assert.ok(!/"used"|"cap":0/.test(json), "plafond en $ sans montants");
    const g = out.runs[0].stats;
    assert.equal(g.usage.totalTokens, 41000, "les tokens restent");
    assert.equal(g.created, 2, "les compteurs restent");
    assert.match(g.cap.detail, /[montant masqué]/);
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
}
