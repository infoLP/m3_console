/* M3-58 / M3-49 — branchement de l'ordonnanceur (src/schedule/scheduler.js) :
   un tick fait-il ce qu'il faut, et rien de plus ? Base, récolte, génération et
   verrou sont simulés par `mock.module`, qui exige l'option
   --experimental-test-module-mocks : `npm test` saute ce fichier,
   `npm run test:wiring` le lance. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("branchement de l'ordonnanceur", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const kv = new Map();
  const articles = new Map();
  let settings = {};
  let calls = [];
  let harvestFails = false;
  let lockHeld = false;
  let logged = [];
  const leases = new Set(); // baux pris par acquire, partagés entre « processus »
  let erased = [];
  let eraseFails = false;
  let scans = [];
  const leaseOpts = {};
  let scanPending = null; // résolution du scan en cours (M3-121)

  mock.module(new URL("lib/yamlStore.js", root).href, { namedExports: { readSettings: async () => settings } });
  mock.module(new URL("lib/store.js", root).href, {
    namedExports: {
      readJson: async (k, fb = null) => (kv.has(k) ? structuredClone(kv.get(k)) : fb),
      writeJson: async (k, v) => { kv.set(k, structuredClone(v)); },
      pushCollection: async (name, item) => { const a = kv.get(name) || []; a.unshift(item); kv.set(name, a); },
      readCollection: async (name) => structuredClone(kv.get(name) || []),
      writeCollection: async (name, arr) => { kv.set(name, structuredClone(arr)); },
      readArticle: async (id) => structuredClone(articles.get(id) || null),
      writeArticle: async (a) => { articles.set(a.id, structuredClone(a)); },
      archiveStale: async () => { calls.push("archive"); return []; },
      eraseExpiredPurges: async (opts) => {
        erased.push(opts);
        if (eraseFails) throw new Error("base injoignable");
        return ["p1", "p2"];
      },
    },
  });
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: {
      query: async (_sql, [nowIso]) => ({
        rows: [...articles.values()].filter((a) => a.status === "valide" && a.publication?.scheduledAt && a.publication.scheduledAt <= nowIso).map((a) => ({ id: a.id })),
      }),
    },
  });
  mock.module(new URL("lib/runLock.js", root).href, {
    namedExports: {
      withLock: async (_name, _owner, fn) => {
        if (lockHeld) throw Object.assign(new Error("Une exécution est déjà en cours"), { status: 409, code: "LOCKED" });
        calls.push("lock"); return fn();
      },
      acquire: async (name, opts) => {
        calls.push(`acquire:${name}`);
        if (leases.has(name)) return null;
        leases.add(name); leaseOpts[name] = opts;
        return "jeton";
      },
    },
  });
  mock.module(new URL("ingest/harvestRun.js", root).href, {
    namedExports: {
      runHarvest: async (opts) => {
        calls.push(`harvest:${opts.scheduled}`);
        if (harvestFails) throw new Error("base injoignable");
        return { stats: { items: 4 } };
      },
    },
  });
  mock.module(new URL("generate/pipeline.js", root).href, {
    namedExports: { runGeneration: async () => { calls.push("generate"); return { created: [1, 2], skipped: [], candidates: 4, provider: "openrouter" }; } },
  });
  /* M3-121 : un scan qui ne finit pas tant que le test ne le libère pas. */
  mock.module(new URL("ingest/competitorScan.js", root).href, {
    namedExports: {
      runCompetitorScan: (opts) => { scans.push(opts); calls.push("scan"); return new Promise((r) => { scanPending = r; }); },
    },
  });
  mock.module(new URL("lib/log.js", root).href, { namedExports: { log: { info() {}, warn() {}, error: (...a) => { logged.push(a); } }, addLogSink() {}, cleanFields: (x) => x } });

  const S = await import(new URL("schedule/scheduler.js", root).href);
  const at = (iso) => Date.parse(iso + "Z") - 2 * 3600000; // heure d'été de Paris
  const reset = (s) => { kv.clear(); articles.clear(); calls = []; scans = []; leases.clear(); logged = []; erased = []; eraseFails = false; scanPending?.(); scanPending = null; harvestFails = false; lockHeld = false; settings = s; };
  const notifs = () => kv.get("notifications") || [];
  /* Un article validé qui remplit les cinq critères avec les réglages par défaut. */
  const conforme = (id) => ({
    id, title: `Titre ${id}`, chapo: "Chapô", status: "valide", ranking: 80, zone: { num: "17" },
    body: [{ id: "b0", type: "h2", text: "Intertitre" }, { id: "b1", type: "p", text: "x".repeat(1600) }],
    source: { type: "site", label: "Mairie", url: "https://example.org/a" },
    illustration: { url: "https://example.org/a.jpg", credit: "© M3" },
    seo: { metaTitle: `Titre ${id}`, metaDescription: "d".repeat(100), slug: `titre-${id}`, keywords: ["a", "b", "c"] },
    decision: { status: "valide", byName: "Camille Relectrice", byRole: "relecteur" },
  });

  test("planification désactivée : aucune chaîne", async () => {
    reset({ schedule_enabled: "non", schedule_times: "06:30" });
    assert.deepEqual(await S.runTick({ now: at("2026-10-12T06:31:00") }), { action: "off" });
    assert.deepEqual(calls, []);
  });

  /* M3-102 : l'archivage automatique passe à chaque tick, planification ou non ;
     sa cadence horaire est tenue par le bail (test/archivageAuto.test.js). */
  test("archivage automatique fermé : runTick ne prend aucun bail et n'archive rien", async () => {
    reset({ schedule_enabled: "non", schedule_times: "06:30", feat_archivage_auto: "non" });
    await S.runTick({ now: at("2026-10-12T06:31:00") });
    assert.deepEqual(calls, []);
  });

  test("archivage automatique ouvert : passe même planification désactivée, sous son propre bail", async () => {
    reset({ schedule_enabled: "non", schedule_times: "06:30", feat_archivage_auto: "oui", archivage_auto_heures: 24 });
    assert.deepEqual(await S.runTick({ now: at("2026-10-12T06:31:00") }), { action: "off" });
    assert.deepEqual(calls, ["acquire:archivage-auto", "archive"]);
  });

  test("activée : le premier tick ne lance rien, le créneau suivant lance la chaîne", async () => {
    reset({ schedule_enabled: "oui", schedule_times: "06:30, 13:30" });
    const first = await S.runTick({ now: at("2026-10-12T07:00:00") });
    assert.equal(first.action, "init");
    assert.deepEqual(calls, []);

    const r = await S.runTick({ now: at("2026-10-12T13:31:00") });
    assert.equal(r.action, "run");
    assert.deepEqual(calls, ["lock", "harvest:true", "generate"], "récolte PLANIFIÉE, puis génération, sous le verrou");
    assert.equal(kv.get("schedule/state.json").lastSlot, "2026-10-12 13:30");
    assert.equal(kv.get("schedule/state.json").lastRun.generation.created, 2);
    assert.equal(kv.get("runs")[0].kind, "schedule");

    calls = [];
    assert.equal((await S.runTick({ now: at("2026-10-12T13:32:00") })).action, "wait", "une seule fois par créneau");
    assert.deepEqual(calls, []);
  });

  test("récolte en échec : pas de génération, une notification", async () => {
    reset({ schedule_enabled: "oui", schedule_times: "06:30" });
    kv.set("schedule/state.json", { lastSlot: "2026-10-11 06:30" });
    harvestFails = true;
    await S.runTick({ now: at("2026-10-12T06:31:00") });
    assert.deepEqual(calls, ["lock", "harvest:true"]);
    assert.equal(notifs()[0].type, "chaine_echec");
    assert.match(notifs()[0].detail, /génération n'a pas été lancée/);
    assert.equal(kv.get("schedule/state.json").lastSlot, "2026-10-12 06:30", "créneau consommé : pas de relance à chaque minute");
  });

  test("verrou tenu par une exécution manuelle : chaîne non lancée, signalée", async () => {
    reset({ schedule_enabled: "oui", schedule_times: "06:30" });
    kv.set("schedule/state.json", { lastSlot: "2026-10-11 06:30" });
    lockHeld = true;
    await S.runTick({ now: at("2026-10-12T06:31:00") });
    assert.deepEqual(calls, []);
    assert.equal(notifs()[0].type, "chaine_echec");
    assert.equal(notifs()[0].severity, "warning");
  });

  test("M3-49 : un article programmé passe en publié à son heure, et pas avant", async () => {
    reset({ schedule_enabled: "non", schedule_times: "06:30" });
    articles.set("a1", { ...conforme("a1"), publication: { scheduledAt: "2026-10-12T08:00:00.000Z", publishedAt: null } });
    articles.set("a2", { ...conforme("a2"), publication: { scheduledAt: "2026-10-13T08:00:00.000Z", publishedAt: null } });
    articles.set("a3", { ...conforme("a3"), publication: null });
    kv.set("publications", [{ articleId: "a1", scheduledAt: "2026-10-12T08:00:00.000Z", publishedAt: null }]);

    await S.runTick({ now: Date.parse("2026-10-12T09:00:00Z") });
    assert.equal(articles.get("a1").status, "publie");
    assert.equal(articles.get("a1").publication.publishedAt, "2026-10-12T08:00:00.000Z", "datée de l'heure programmée");
    assert.equal(articles.get("a2").status, "valide", "pas avant l'heure");
    assert.equal(articles.get("a3").status, "valide", "validé sans programmation : intact");
    assert.equal(kv.get("publications")[0].publishedAt, "2026-10-12T08:00:00.000Z", "journal des publications à jour");
  });

  test("M3-72 : à l'heure dite, un article qui a perdu un critère revient dans la file, notifié", async () => {
    reset({ schedule_enabled: "non", schedule_times: "06:30" });
    const sansSeo = { ...conforme("b1"), seo: { metaTitle: "", metaDescription: "", slug: "", keywords: [] } };
    articles.set("b1", { ...sansSeo, publication: { scheduledAt: "2026-10-12T07:00:00.000Z", publishedAt: null } });
    kv.set("publications", [{ articleId: "b1", scheduledAt: "2026-10-12T07:00:00.000Z", publishedAt: null }]);

    await S.runTick({ now: Date.parse("2026-10-12T09:00:00Z") });
    const b1 = articles.get("b1");
    assert.equal(b1.status, "a_revoir", "pas de parution : retour dans la file");
    assert.equal(b1.publication.scheduledAt, null, "programmation annulée");
    assert.equal(b1.publication.blockedScheduledAt, "2026-10-12T07:00:00.000Z");
    assert.deepEqual(b1.publication.missing, ["SEO complet"]);
    const n = notifs()[0];
    assert.equal(n.type, "parution_bloquee");
    assert.match(n.detail, /« Titre b1 », validé par Camille Relectrice, devait paraître le 12\/10 à 09:00/, "article, personne et heure de Paris");
    assert.match(n.detail, /Manque : SEO complet\./);
    assert.equal(kv.get("publications")[0].publishedAt, null, "pas datée comme parue");
    assert.ok(kv.get("publications")[0].blockedAt, "programmation marquée bloquée");
  });

  test("M3-72 : l'illustration suit la FEAT du rôle qui a validé", async () => {
    // seul l'administrateur peut publier sans image
    reset({ schedule_enabled: "non", schedule_times: "06:30", feat_sans_illustration_min_role: "administrateur" });
    const sansImage = (id, byRole) => ({ ...conforme(id), illustration: null, decision: { status: "valide", byName: "X", byRole },
      publication: { scheduledAt: "2026-10-12T07:00:00.000Z", publishedAt: null } });
    articles.set("c1", sansImage("c1", "administrateur"));
    articles.set("c2", sansImage("c2", "relecteur"));

    await S.runTick({ now: Date.parse("2026-10-12T09:00:00Z") });
    assert.equal(articles.get("c1").status, "publie", "FEAT ouverte au validateur : image non exigée");
    assert.equal(articles.get("c2").status, "a_revoir", "FEAT fermée au validateur : image exigée");
    assert.deepEqual(articles.get("c2").publication.missing, ["Illustration"]);
  });

  /* --- M3-121 : scan des concurrents planifié ----------------------------- */

  /* Un tick qui attendrait le scan (jamais fini ici) échoue au lieu de pendre. */
  const tickNow = (now) => {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("tick bloqué par le scan")), 2000); });
    return Promise.race([S.runTick({ now }), late]).finally(() => clearTimeout(timer));
  };
  /* Le scan part après le tick (module chargé à la demande) : on l'attend. */
  const scanStarted = async (n) => {
    for (let i = 0; i < 100 && scans.length < n; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(scans.length, n, "scan lancé");
  };

  test("M3-121 critère 1 : scan désactivé (ou réglage absent) → jamais lancé, même au créneau", async () => {
    reset({ schedule_enabled: "non", schedule_times: "06:30", competitors_scan_times: "02:30" });
    kv.set("schedule/competitors.json", { lastSlot: "2026-10-11 02:30" });
    await S.runTick({ now: at("2026-10-12T02:31:00") });
    assert.deepEqual(scans, []);
    assert.equal(kv.get("schedule/competitors.json").lastSlot, null, "réactiver repartira de l'heure courante");
    settings = { ...settings, competitors_scan_enabled: "non" };
    await S.runTick({ now: at("2026-10-12T02:32:00") });
    assert.deepEqual(scans, []);
  });

  test("M3-121 critère 1 : activé → rien à l'activation, lancé au créneau, sans bloquer le tick ni la chaîne", async () => {
    reset({ schedule_enabled: "oui", schedule_times: "06:30", competitors_scan_enabled: "oui", competitors_scan_times: "02:30, 06:30" });
    kv.set("schedule/state.json", { lastSlot: "2026-10-12 02:30" });
    assert.equal((await S.competitorsDue(settings, at("2026-10-12T05:00:00"))).action, "init", "activer ne lance rien");
    assert.deepEqual(scans, []);

    /* 06:31 : le scan ET la chaîne sont dus. Le scan ne se termine jamais : le
       tick rend la main quand même, et la chaîne a tourné sous SON verrou. */
    const r = await tickNow(at("2026-10-12T06:31:00"));
    assert.equal(r.action, "run");
    assert.deepEqual(calls.filter((c) => c !== "scan"), ["lock", "harvest:true", "generate"], "la chaîne n'attend pas le scan");
    await scanStarted(1);
    assert.deepEqual(scans, [{ trigger: "planifie", by: null }]);
    assert.equal(kv.get("schedule/competitors.json").lastSlot, "2026-10-12 06:30");
    assert.equal(kv.get("schedule/state.json").lastSlot, "2026-10-12 06:30", "états distincts");

    await tickNow(at("2026-10-12T06:32:00"));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(scans.length, 1, "une seule fois par créneau");
    scanPending();
  });

  test("M3-121 : scan qui échoue → journalisé, le tick suivant tourne", async () => {
    reset({ schedule_enabled: "non", schedule_times: "06:30", competitors_scan_enabled: "oui", competitors_scan_times: "02:30, 03:30" });
    kv.set("schedule/competitors.json", { lastSlot: "2026-10-12 02:30" });
    await tickNow(at("2026-10-12T03:31:00"));
    await scanStarted(1);
    scanPending(Promise.reject(new Error("base injoignable")));
    await new Promise((r) => setImmediate(r));
    kv.set("schedule/competitors.json", { lastSlot: "2026-10-12 02:30" });
    await tickNow(at("2026-10-12T03:32:00"));
    await scanStarted(2);
    scanPending();
  });

  /* --- T15 : effacement quotidien des purges expirées ---------------------- */

  test("T15 : purge_retention_days à 0 ou absent → aucun appel, aucun bail", async () => {
    for (const s of [{ purge_retention_days: 0 }, {}]) {
      reset({ schedule_enabled: "non", schedule_times: "06:30", ...s });
      await S.runTick({ now: at("2026-10-12T06:31:00") });
      await S.runTick({ now: at("2026-10-13T06:31:00") });
      assert.deepEqual(erased, []);
      assert.ok(!calls.includes("acquire:purges-expirees"));
    }
  });

  test("T15 : réglage > 0 → un appel par jour au plus, même sur plusieurs ticks ou processus", async () => {
    reset({ schedule_enabled: "non", schedule_times: "06:30", purge_retention_days: 30 });
    const now = at("2026-10-12T06:31:00");
    await S.runTick({ now });
    await S.runTick({ now: now + 60000 });
    await S.erasePurgesDue(settings, now + 120000); // un second worker, même base, même bail
    assert.deepEqual(erased, [{ days: 30, now }], "un seul passage");
    assert.equal(leaseOpts["purges-expirees"].ttlMs, 24 * 3600000, "bail de 24 h, jamais relâché");
    assert.ok(leases.has("purges-expirees"));

    leases.delete("purges-expirees"); // le lendemain, le bail a expiré
    await S.runTick({ now: now + 86400000 });
    assert.equal(erased.length, 2);
  });

  test("T15 : effacement en erreur → journalisé, le tick continue (chaîne lancée)", async () => {
    reset({ schedule_enabled: "oui", schedule_times: "06:30", purge_retention_days: 7 });
    kv.set("schedule/state.json", { lastSlot: "2026-10-11 06:30" });
    eraseFails = true;
    const r = await S.runTick({ now: at("2026-10-12T06:31:00") });
    assert.equal(erased.length, 1);
    assert.deepEqual(logged, [["schedule", "effacement des purges expirées", { erreur: "base injoignable" }]]);
    assert.equal(r.action, "run");
    assert.deepEqual(calls.filter((c) => c !== "acquire:purges-expirees"), ["lock", "harvest:true", "generate"]);
  });
}
