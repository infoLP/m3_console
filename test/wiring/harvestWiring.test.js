/* M3-58 — récolte planifiée (src/ingest/harvestRun.js) : sources sautées, mise à
   l'écart notifiée une fois, fenêtre élargie au dernier succès, report des
   contenus non générés. Base et récupérateurs simulés par `mock.module` :
   `npm run test:wiring` (option --experimental-test-module-mocks). */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("branchement de la récolte", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const kv = new Map();
  let sources = [];
  let fail = new Set();
  let cutoffs = {};
  let failUpdate = new Set();
  let extraSettings = {};

  mock.module(new URL("lib/yamlStore.js", root).href, {
    namedExports: {
      readSettings: async () => ({ window_hours: 72, request_timeout_ms: 1000, max_items_per_source: 10, ...extraSettings }),
      readSources: async () => structuredClone(sources),
    },
  });
  mock.module(new URL("lib/store.js", root).href, {
    namedExports: {
      readJson: async (k, fb = null) => (kv.has(k) ? structuredClone(kv.get(k)) : fb),
      writeJson: async (k, v) => { kv.set(k, structuredClone(v)); },
      /* Atomique, comme la version PostgreSQL sous FOR UPDATE (test/storeUpdateJson.test.js). */
      updateJson: async (k, fn, fb = null) => {
        if (failUpdate.has(k)) { failUpdate.delete(k); throw new Error("base injoignable"); } const v = fn(kv.has(k) ? structuredClone(kv.get(k)) : fb); kv.set(k, structuredClone(v)); return v; },
      dataPath: (...p) => p.join("/"),
      pushCollection: async (name, item) => { const a = kv.get(name) || []; a.unshift(item); kv.set(name, a); },
    },
  });
  let empty = new Set();
  let seenProbe = {};
  /* M3-57 : url → "ok" | "refus" ; simule le résultat du furtif sur un 403. */
  let furtif = {};
  let stealthProbe = {};
  /* T6 : url → true si le 403 a disparu (recontrôle de la liste blanche) ; url → true si
     le furtif échoue pour une source en liste blanche ; délai simulé par source. */
  let recovered = {};
  let whitelistFail = {};
  let delay = {};
  const fetcher = async (url, opts) => {
    cutoffs[url] = opts.cutoffMs;
    seenProbe[url] = opts.isSeen;
    stealthProbe[url] = { stealth: !!opts.stealth, stealthFirst: !!opts.stealthFirst, stealthRecheck: !!opts.stealthRecheck };
    if (delay[url]) await new Promise((r) => setTimeout(r, delay[url]));
    if (opts.stealthFirst && opts.stealthRecheck && recovered[url]) return { ok: true, furtif: "sortie", items: [{ externalId: `${url}#${Date.now()}`, title: "t", link: url, rawText: "x", publishedAt: null }] };
    if (opts.stealthFirst && whitelistFail[url]) return { ok: false, furtif: "refus", error: "furtif : HTTP 403", items: [] };
    if (opts.stealthFirst) return { ok: true, items: [{ externalId: `${url}#${Date.now()}`, title: "t", link: url, rawText: "x", publishedAt: null }], diag: { via: "furtif" } };
    if (furtif[url] && opts.stealth) {
      return furtif[url] === "ok"
        ? { ok: true, furtif: "ok", items: [{ externalId: `${url}#${Date.now()}`, title: "t", link: url, rawText: "x", publishedAt: null }] }
        : { ok: false, furtif: "refus", error: "HTTP 403 (furtif : HTTP 403)", items: [] };
    }
    if (furtif[url]) return { ok: false, error: "HTTP 403", items: [] };
    if (fail.has(url)) return { ok: false, error: "HTTP 503", items: [] };
    if (empty.has(url)) return { ok: true, items: [] };
    return { ok: true, items: [{ externalId: `${url}#${Date.now()}`, title: "t", link: url, rawText: "x", publishedAt: null }] };
  };
  mock.module(new URL("ingest/fetchFeed.js", root).href, { namedExports: { harvestFeed: fetcher } });
  mock.module(new URL("ingest/fetchArticleList.js", root).href, { namedExports: { harvestArticleList: fetcher } });
  mock.module(new URL("ingest/fetchPdf.js", root).href, { namedExports: { harvestPdf: fetcher } });

  const { runHarvest, SOURCES_STATE_KEY } = await import(new URL("ingest/harvestRun.js", root).href);
  const src = (id, extra = {}) => ({ id, name: id, active: true, rssUrl: `https://${id}.fr/rss`, ...extra });
  const notifs = () => kv.get("notifications") || [];
  const reset = () => { kv.clear(); fail = new Set(); empty = new Set(); cutoffs = {}; seenProbe = {}; furtif = {}; stealthProbe = {}; extraSettings = {}; recovered = {}; whitelistFail = {}; delay = {}; failUpdate = new Set(); delete process.env.M3_RENDER_FALLBACK; };
  const page = (id) => ({ id, name: id, active: true, listUrl: `https://${id}.fr/actualites` });

  test("planifiée : une source pas encore due est sautée, à part, sans être « muette »", async () => {
    reset();
    sources = [src("a"), src("m", { intervalDays: 7 })];
    kv.set(SOURCES_STATE_KEY, { m: { lastOkAt: new Date(Date.now() - 86400000).toISOString() } });
    const h = await runHarvest({ scheduled: true });
    assert.deepEqual(h.sources.map((s) => s.id), ["a"], "seules les sources interrogées dans `sources`");
    assert.deepEqual(h.skipped.map((s) => [s.id, s.reason]), [["m", "pas_due"]]);
    assert.equal(h.stats.sources, 1);
    assert.equal(h.stats.notDue, 1);
  });

  test("manuelle : l'intervalle est ignoré, toutes les sources sont interrogées", async () => {
    reset();
    sources = [src("m", { intervalDays: 7 })];
    kv.set(SOURCES_STATE_KEY, { m: { lastOkAt: new Date().toISOString() } });
    const h = await runHarvest();
    assert.deepEqual(h.sources.map((s) => s.id), ["m"]);
  });

  test("la fenêtre d'une source hebdomadaire part de son dernier succès", async () => {
    reset();
    const lastOk = Date.now() - 8 * 86400000;
    sources = [src("w", { intervalDays: 7 })];
    kv.set(SOURCES_STATE_KEY, { w: { lastOkAt: new Date(lastOk).toISOString() } });
    await runHarvest({ scheduled: true });
    assert.equal(cutoffs["https://w.fr/rss"], lastOk, "et non 72 h : les contenus de la semaine ne sont pas perdus");
  });

  test("trois échecs : une notification de mise à l'écart à la place du 3e échec, puis la source est sautée", async () => {
    reset();
    sources = [src("x")];
    fail.add("https://x.fr/rss");
    await runHarvest(); await runHarvest(); await runHarvest();
    assert.deepEqual(notifs().map((n) => n.type).reverse(), ["source_inaccessible", "source_inaccessible", "source_ecartee"]);
    assert.match(notifs()[0].detail, /mise à l'écart/);

    const h = await runHarvest();
    assert.deepEqual(h.skipped.map((s) => [s.id, s.reason]), [["x", "ecartee"]]);
    assert.equal(notifs().length, 3, "aucune notification de plus pendant la mise à l'écart");
  });

  test("M3-50 : une source qui répond sans rien rapporter est signalée « muette » une seule fois", async () => {
    reset();
    sources = [src("q")];
    empty.add("https://q.fr/rss");
    for (let i = 0; i < 7; i++) await runHarvest();
    assert.deepEqual(notifs().map((n) => n.type), ["source_muette"]);
    const y = kv.get(SOURCES_STATE_KEY).q.yield;
    assert.equal(y.emptyStreak, 7);
    assert.equal(y.runs, 7);
  });

  test("M3-50 : les récupérateurs reçoivent isSeen, branché sur seen.json de la source", async () => {
    reset();
    sources = [src("a")];
    kv.set("harvest/seen.json", { "a:deja": new Date().toISOString(), "b:autre": new Date().toISOString() });
    await runHarvest();
    const isSeen = seenProbe["https://a.fr/rss"];
    assert.equal(isSeen("deja"), true);
    assert.equal(isSeen("autre"), false, "les clés d'une autre source ne comptent pas");
  });

  test("les contenus non générés de la récolte précédente sont reportés, les traités non", async () => {
    reset();
    sources = [src("a")];
    kv.set("harvest/latest.json", { items: [
      { id: "old_pending", processed: false, harvestedAt: new Date().toISOString() },
      { id: "old_done", processed: true, harvestedAt: new Date().toISOString() },
      { id: "too_old", processed: false, harvestedAt: new Date(Date.now() - 20 * 86400000).toISOString() },
    ] });
    const h = await runHarvest();
    const ids = h.items.map((i) => i.id);
    assert.ok(ids.includes("old_pending"));
    assert.ok(!ids.includes("old_done"));
    assert.ok(!ids.includes("too_old"), "pas au-delà de 14 jours");
    assert.equal(h.stats.carried, 1);
    assert.equal(h.stats.items, 1, "les nouveaux seuls comptent comme récoltés");
  });

  /* M3-57 : crawler furtif sur 403, liste blanche et mise à l'écart automatiques. */
  test("furtif : 403 puis furtif réussi → liste blanche, notification, puis furtif direct", async () => {
    reset();
    extraSettings = { harvest_render_fallback: "furtif" };
    sources = [page("cci")];
    furtif["https://cci.fr/actualites"] = "ok";
    const h = await runHarvest();
    assert.equal(h.sources[0].ok, true);
    assert.ok(kv.get(SOURCES_STATE_KEY).cci.furtif?.since, "inscrite en liste blanche");
    assert.deepEqual(notifs().map((n) => n.type), ["source_furtif"]);
    assert.deepEqual(stealthProbe["https://cci.fr/actualites"], { stealth: true, stealthFirst: false, stealthRecheck: false });

    await runHarvest();
    assert.deepEqual(stealthProbe["https://cci.fr/actualites"], { stealth: true, stealthFirst: true, stealthRecheck: false }, "la récolte suivante passe d'emblée par le furtif");
    assert.equal(notifs().length, 1, "pas de seconde notification");
  });

  test("furtif : 403 puis furtif refusé → mise à l'écart sur-le-champ, notification, source sautée ensuite", async () => {
    reset();
    extraSettings = { harvest_render_fallback: "furtif" };
    sources = [page("but")];
    furtif["https://but.fr/actualites"] = "refus";
    const h = await runHarvest();
    assert.equal(h.sources[0].ok, false);
    assert.equal(h.stats.quarantinedNow, 1);
    const st = kv.get(SOURCES_STATE_KEY).but;
    assert.equal(st.furtif, undefined, "pas de liste blanche");
    assert.ok(Date.parse(st.quarantinedUntil) > Date.now());
    assert.deepEqual(notifs().map((n) => n.type), ["source_ecartee"]);
    assert.match(notifs()[0].detail, /furtif/);

    const h2 = await runHarvest();
    assert.deepEqual(h2.skipped.map((s) => [s.id, s.reason]), [["but", "ecartee"]]);
  });

  test("furtif : réglage « playwright » → pas de furtif, un 403 reste un échec ordinaire", async () => {
    reset();
    extraSettings = { harvest_render_fallback: "playwright" };
    sources = [page("cci")];
    furtif["https://cci.fr/actualites"] = "ok";
    const h = await runHarvest();
    assert.equal(h.sources[0].ok, false);
    assert.deepEqual(stealthProbe["https://cci.fr/actualites"], { stealth: false, stealthFirst: false, stealthRecheck: false });
    assert.deepEqual(notifs().map((n) => n.type), ["source_inaccessible"]);
  });

  test("furtif : coupe-circuit M3_RENDER_FALLBACK=0 → ni furtif ni liste blanche", async () => {
    reset();
    extraSettings = { harvest_render_fallback: "furtif" };
    sources = [page("cci")];
    kv.set(SOURCES_STATE_KEY, { cci: { furtif: { since: new Date().toISOString() } } });
    process.env.M3_RENDER_FALLBACK = "0";
    try {
      await runHarvest();
      assert.deepEqual(stealthProbe["https://cci.fr/actualites"], { stealth: false, stealthFirst: false, stealthRecheck: false });
    } finally {
      delete process.env.M3_RENDER_FALLBACK;
    }
  });

  /* T6 : furtif robuste. */
  const listed = (days) => ({ furtif: { since: new Date(Date.now() - days * 86400000).toISOString() } });

  test("T6 : liste blanche recontrôlée après 7 jours ; le 403 a disparu → sortie de liste, notification", async () => {
    reset();
    extraSettings = { harvest_render_fallback: "furtif" };
    sources = [page("cci")];
    kv.set(SOURCES_STATE_KEY, { cci: listed(8) });
    recovered["https://cci.fr/actualites"] = true;
    const h = await runHarvest();
    assert.equal(h.sources[0].ok, true);
    assert.equal(stealthProbe["https://cci.fr/actualites"].stealthRecheck, true);
    assert.equal(kv.get(SOURCES_STATE_KEY).cci.furtif, undefined, "sortie de la liste blanche");
    assert.deepEqual(notifs().map((n) => n.type), ["source_furtif"]);
    assert.match(notifs()[0].detail, /sort de la liste blanche/);
  });

  test("T6 : liste blanche récente → pas de recontrôle ; recontrôle toujours en 403 → reste, date du contrôle notée", async () => {
    reset();
    extraSettings = { harvest_render_fallback: "furtif" };
    sources = [page("cci")];
    kv.set(SOURCES_STATE_KEY, { cci: listed(2) });
    await runHarvest();
    assert.equal(stealthProbe["https://cci.fr/actualites"].stealthRecheck, false);

    kv.set(SOURCES_STATE_KEY, { cci: listed(8) });
    await runHarvest();
    const f = kv.get(SOURCES_STATE_KEY).cci.furtif;
    assert.ok(f, "toujours en liste blanche");
    assert.ok(Date.now() - Date.parse(f.checkedAt) < 60000, "contrôle daté : pas de nouveau recontrôle avant 7 jours");
  });

  test("T6 : échec furtif d'une source en liste blanche → mise à l'écart + source_ecartee", async () => {
    reset();
    extraSettings = { harvest_render_fallback: "furtif" };
    sources = [page("ademe")];
    kv.set(SOURCES_STATE_KEY, { ademe: listed(1) });
    whitelistFail["https://ademe.fr/actualites"] = true;
    const h = await runHarvest();
    assert.equal(h.stats.quarantinedNow, 1);
    assert.ok(Date.parse(kv.get(SOURCES_STATE_KEY).ademe.quarantinedUntil) > Date.now());
    assert.deepEqual(notifs().map((n) => n.type), ["source_ecartee"]);
    assert.match(notifs()[0].detail, /liste blanche/);
  });

  test("T6 : deux récoltes concurrentes ne perdent pas d'inscription en liste blanche", async () => {
    reset();
    extraSettings = { harvest_render_fallback: "furtif" };
    furtif["https://cci.fr/actualites"] = "ok";
    furtif["https://but.fr/actualites"] = "ok";
    delay["https://cci.fr/actualites"] = 30;
    sources = [page("cci"), page("but")];
    /* cci répond après but : la 1re récolte, partie avec un état vide, écrit en dernier. */
    await Promise.all([runHarvest({ only: ["cci"] }), runHarvest({ only: ["but"] })]);
    const st = kv.get(SOURCES_STATE_KEY);
    assert.ok(st.cci?.furtif, "inscription de la 1re récolte gardée");
    assert.ok(st.but?.furtif, "inscription de la 2e récolte gardée");
  });

  test("T6 : une écriture d'état qui échoue n'arrête pas la récolte, la source suivante est enregistrée", async () => {
    reset();
    sources = [src("a"), src("b")];
    failUpdate.add(SOURCES_STATE_KEY);
    const h = await runHarvest();
    assert.deepEqual(h.sources.map((s) => [s.id, s.ok]), [["a", true], ["b", true]]);
    const st = kv.get(SOURCES_STATE_KEY);
    assert.equal(st.a, undefined, "l'écriture de a a échoué");
    assert.ok(st.b?.lastOkAt, "b enregistrée malgré l'échec de a");
  });

  test("T6 : seen.json fusionné sous verrou — deux récoltes concurrentes gardent leurs clés", async () => {
    reset();
    sources = [src("a"), src("b")];
    delay["https://a.fr/rss"] = 30;
    await Promise.all([runHarvest({ only: ["a"] }), runHarvest({ only: ["b"] })]);
    const keys = Object.keys(kv.get("harvest/seen.json"));
    assert.ok(keys.some((k) => k.startsWith("a:")), "clés de a");
    assert.ok(keys.some((k) => k.startsWith("b:")), "clés de b");
  });

  test("M3-116 : une source retirée de la liste blanche pendant la récolte n'y est pas remise", async () => {
    reset();
    extraSettings = { harvest_render_fallback: "furtif" };
    sources = [page("a"), page("w")];
    delay["https://a.fr/actualites"] = 30;
    const since = new Date().toISOString();
    kv.set(SOURCES_STATE_KEY, { w: { furtif: { since } }, a: { furtif: { since } } });
    const run = runHarvest();
    /* L'administrateur retire w pendant que le run est encore sur a. */
    await new Promise((r) => setTimeout(r, 10));
    const st = kv.get(SOURCES_STATE_KEY);
    delete st.w.furtif;
    kv.set(SOURCES_STATE_KEY, st);
    await run;
    const after = kv.get(SOURCES_STATE_KEY);
    assert.equal(after.w.furtif, undefined, "retrait gardé");
    assert.ok(after.w.lastOkAt, "le reste de l'état de w est bien écrit");
    assert.ok(after.a.furtif, "a, non retirée, reste en liste blanche");
  });

  test("M3-116 : FURTIF_RECHECK_MS exporté (7 jours)", async () => {
    const { FURTIF_RECHECK_MS } = await import(new URL("ingest/harvestRun.js", root).href);
    assert.equal(FURTIF_RECHECK_MS, 7 * 86400000);
  });
}
