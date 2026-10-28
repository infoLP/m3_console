/* M3-73 — branchement du contrôle de périmètre dans la génération
   (src/generate/pipeline.js) : un sujet hors Nouvelle-Aquitaine coûte-t-il bien
   l'extraction seule, et laisse-t-il une trace ? Base et LLM sont simulés par
   `mock.module`, qui exige l'option --experimental-test-module-mocks :
   `npm test` saute ce fichier, `npm run test:wiring` le lance. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("branchement du contrôle de périmètre", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const kv = new Map();
  const articles = new Map();
  let calls = [];
  let extraction = {};
  /* Anti-régénération (T14) : clés de contenus déjà générés, pilotées par test. */
  let dejaGeneres = new Set();
  /* Relances (M3-55) : réglages, verdicts de relecture et moteurs pilotés par test. */
  let extraSettings = {};
  let verdicts = [];
  const NO_REVIEW = { verdicts: null };

  mock.module(new URL("lib/yamlStore.js", root).href, { namedExports: { readSettings: async () => ({ region: "Nouvelle-Aquitaine", dedup_threshold: 0.9, ...extraSettings }) } });
  mock.module(new URL("lib/store.js", root).href, {
    namedExports: {
      dataPath: (...p) => p.join("/"),
      readJson: async (k) => (kv.has(k) ? structuredClone(kv.get(k)) : null),
      writeJson: async (k, v) => { kv.set(k, structuredClone(v)); },
      pushCollection: async (name, item) => { const a = kv.get(name) || []; a.unshift(item); kv.set(name, a); },
      writeArticle: async (a) => { articles.set(a.id, structuredClone(a)); },
      readArticle: async (id) => structuredClone(articles.get(id) || null),
      listArticleIds: async () => [...articles.keys()],
      readIndex: async () => [],
      generatedItemKeys: async (keys) => new Set(keys.filter((k) => dejaGeneres.has(k))),
    },
  });
  const llmStats = { fallbacks: 0, capped: 0, capHit: null, configured: "openrouter", lastError: null, usage: { billedCalls: 0 } };
  mock.module(new URL("llm/index.js", root).href, {
    namedExports: {
      providerName: () => "openrouter", providerLabel: () => "OpenRouter", llmLimits: () => ({}),
      llmStats,
      resetLlmStats: async () => { delete llmStats.regen; },
      extractFromSource: async () => { calls.push("extract"); return structuredClone(extraction); },
      generateArticle: async (_ex, opts = {}) => {
        calls.push(opts.engine ? `generate:${opts.engine.id}` : "generate");
        const by = opts.engine ? { provider: opts.engine.id, model: opts.engine.model } : { provider: "openrouter", model: "m/a" };
        return { title: "Un tramway inauguré", chapo: "Chapô.", body: [{ type: "p", text: "Corps." }], category: "Société", suggested_ranking: 50, seo: {}, prompt: { scope: "defaut", id: null, version: null, ...by } };
      },
      checkPlagiarism: async () => ({ verdict: "ok", score: 0 }),
      // relecture automatique (M3-89) : désactivée (null) sauf si un test pose des verdicts
      reviewArticle: async () => {
        if (NO_REVIEW.verdicts === null) return null;
        calls.push("review");
        return { status: "fait", engine: "relecteur", ...(verdicts.shift() || { verdict: "ok", hallucinations: [], resume: "" }) };
      },
      // relances sur hallucination (M3-55, src/generate/relance.js)
      describeEngine: async ({ id, model }) => ({ id, model: model || `${id}/defaut`, label: id, issue: null }),
    },
  });

  const { runGeneration } = await import(new URL("generate/pipeline.js", root).href);

  /* Texte qui passe les filtres d'avant extraction (longueur, langue, pas d'index). */
  const raw = (lieu) => `La ville de ${lieu} inaugure ce mardi une nouvelle ligne de tramway qui dessert les quartiers nord. `
    + "Les travaux ont duré trois ans et coûté 120 millions d'euros, selon les services de la collectivité. "
    + "Le maire a salué un chantier mené dans les délais, malgré les difficultés d'approvisionnement des rails. "
    + "Les habitants pourront emprunter la ligne gratuitement pendant tout le premier week-end de service. "
    + "Une deuxième ligne est déjà à l'étude pour relier le centre aux communes de la première couronne. "
    + "La fréquence annoncée est d'une rame toutes les six minutes aux heures de pointe, et dix le reste du temps.";

  const reset = (lieu, ex) => {
    kv.clear(); articles.clear(); calls = []; extraction = ex; dejaGeneres = new Set();
    extraSettings = {}; verdicts = []; NO_REVIEW.verdicts = null;
    kv.set("harvest/latest.json", { date: "2026-10-13", items: [{ id: "h1", sourceId: "s1", sourceName: "Source test", url: "https://exemple.fr/a", mode: "official", rawText: raw(lieu) }] });
  };

  test("hors Nouvelle-Aquitaine : extraction seule, pas d'article, notification avec le lien", async () => {
    reset("Lyon", { title_hint: "Lyon inaugure un tramway", facts: ["La ville de Lyon inaugure une ligne de tramway."], entities: ["Lyon"], locality: "Lyon" });
    const r = await runGeneration();
    assert.deepEqual(calls, ["extract"], "l'appel de génération n'a pas lieu");
    assert.equal(r.created.length, 0);
    assert.deepEqual(r.skipped.map((s) => s.reason), ["hors_sujet"]);
    const n = kv.get("notifications")[0];
    assert.equal(n.type, "hors_sujet");
    assert.equal(n.url, "https://exemple.fr/a");
    assert.match(n.detail, /avant génération.*lyon/i);
    assert.equal(kv.get("harvest/latest.json").items[0].processed, true, "pas repris à chaque run");
  });

  test("sujet local : génération normale", async () => {
    reset("Rochefort", { title_hint: "Rochefort inaugure un tramway", facts: ["La ville de Rochefort inaugure une ligne de tramway."], entities: ["Rochefort"], locality: "Rochefort" });
    const r = await runGeneration();
    assert.deepEqual(calls, ["extract", "generate"]);
    assert.equal(r.created.length, 1);
  });

  test("état de la source (M3-107, C1) : enregistré sur le nouvel article", async () => {
    reset("Rochefort", LOCAL_SRC);
    const r = await runGeneration();
    const a = articles.get(r.created[0].id ?? r.created[0]);
    assert.ok(Array.isArray(a.checks.sources) && a.checks.sources.length === 1, "checks.sources recopié dans l'article");
    const s = a.checks.sources[0];
    assert.equal(s.url, "https://exemple.fr/a");
    assert.equal(s.etat, "lue");
    assert.ok(s.signes > 200);
    assert.equal(s.emetteurNomme, false, "« Source test » n'est pas nommée dans l'article");
    /* Frise des durées (B1) : le run garde son début, avant sa fin (`at`). */
    const run = kv.get("runs")[0];
    assert.match(run.stats.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(run.stats.startedAt <= run.at);
  });

  const LOCAL_SRC = { title_hint: "Rochefort inaugure un tramway", facts: ["La ville de Rochefort inaugure une ligne de tramway."], entities: ["Rochefort"], locality: "Rochefort" };
  const REJET = { verdict: "rejet", hallucinations: [{ extrait: "200 millions", explication: "la source dit 120" }], resume: "Montant inventé.", suggestionPrompt: "Reprendre les montants exacts." };
  const LOCAL = { title_hint: "Rochefort inaugure un tramway", facts: ["La ville de Rochefort inaugure une ligne de tramway."], entities: ["Rochefort"], locality: "Rochefort" };

  test("relances (M3-55) : liste vide → rejet signalé comme avant, aucune relance ni trace", async () => {
    reset("Rochefort", LOCAL);
    NO_REVIEW.verdicts = true; verdicts = [REJET];
    await runGeneration();
    assert.deepEqual(calls, ["extract", "generate", "review"]);
    const a = [...articles.values()][0];
    assert.equal(a.status, "signale");
    assert.deepEqual(a.flags.map((f) => f.type), ["relecture_llm"]);
    assert.equal("regen" in a.checks, false);
    assert.equal(kv.get("runs")[0].stats.regen, null);
  });

  test("relances (M3-55) : hallucination persistante → article gardé signalé, notification, trace", async () => {
    reset("Rochefort", LOCAL);
    NO_REVIEW.verdicts = true; verdicts = [REJET, REJET, REJET];
    extraSettings = { llm_regen_max: 2, llm_regen_engines: "alpha:a/1, beta" };
    const r = await runGeneration();
    assert.deepEqual(calls, ["extract", "generate", "review", "generate:alpha", "review", "generate:beta", "review"]);
    assert.equal(r.created.length, 1);
    const a = [...articles.values()][0];
    assert.equal(a.status, "signale", "gardé dans la file, pas archivé");
    assert.equal(a.checks.regen.issue, "hallucination_persistante");
    assert.equal(a.checks.regen.retenue, 2, "à égalité, la plus récente");
    assert.equal(a.provider, "beta");
    const n = kv.get("notifications").find((x) => x.type === "llm_hallucination");
    assert.ok(n);
    assert.equal(n.articleId, a.id);
    assert.equal(n.url, "https://exemple.fr/a");
    assert.match(n.detail, new RegExp(a.id));
    assert.match(n.detail, /Source test/);
    const st = kv.get("runs")[0].stats.regen;
    assert.deepEqual([st.articles, st.relances, st.persistantes], [1, 2, 1]);
    assert.deepEqual(st.suggestions, ["Reprendre les montants exacts."]);
  });

  test("relances (M3-55) : la 2e version passe → retenue, pas de notification", async () => {
    reset("Rochefort", LOCAL);
    NO_REVIEW.verdicts = true; verdicts = [REJET, { verdict: "ok", hallucinations: [], resume: "Fidèle." }];
    extraSettings = { llm_regen_max: 2, llm_regen_engines: "alpha" };
    await runGeneration();
    const a = [...articles.values()][0];
    assert.equal(a.status, "a_revoir");
    assert.equal(a.checks.regen.issue, "ok");
    assert.equal(a.checks.review.verdict, "ok");
    assert.equal(a.provider, "alpha");
    assert.equal((kv.get("notifications") || []).some((x) => x.type === "llm_hallucination"), false);
  });

  /* M3-115, piste 2 — contrôle de date avant l'appel au modèle. */
  const setItem = (patch) => { const h = kv.get("harvest/latest.json"); Object.assign(h.items[0], patch); };
  const ilYa = (j) => new Date(Date.now() - j * 86400000).toISOString();

  test("date (M3-115) : parution hors fenêtre → aucun appel au modèle, écarté avec le motif", async () => {
    reset("Rochefort", LOCAL_SRC);
    setItem({ title: "Déplacez-vous autrement avec la Semaine de la mobilité", publishedAt: "2024-09-16T10:00:00Z" });
    const r = await runGeneration();
    assert.deepEqual(calls, [], "ni extraction ni génération");
    assert.equal(r.created.length, 0);
    assert.deepEqual(r.skipped.map((s) => s.reason), ["date_suspecte"]);
    assert.match(r.skipped[0].detail, /hors fenêtre de récupération/);
    const n = kv.get("notifications")[0];
    assert.equal(n.type, "date_suspecte");
    assert.equal(n.url, "https://exemple.fr/a");
    assert.match(n.detail, /avant génération.*16 septembre 2024.*hors fenêtre de récupération/);
    assert.equal(kv.get("harvest/latest.json").items[0].processed, true, "pas repris à chaque run");
  });

  test("date (M3-115) : étiquette « Publié le » ancienne dans le texte, sans date de récolte → aucun appel", async () => {
    reset("Rochefort", LOCAL_SRC);
    setItem({ rawText: "Publié le 16 sept. 2024 - Mis à jour le 17 sept. 2024. " + raw("Rochefort") });
    const r = await runGeneration();
    assert.deepEqual(calls, []);
    assert.deepEqual(r.skipped.map((s) => s.reason), ["date_suspecte"]);
  });

  test("date (M3-115) : dans la fenêtre → génération inchangée, sans drapeau de date", async () => {
    reset("Rochefort", LOCAL_SRC);
    setItem({ publishedAt: ilYa(1) });
    const r = await runGeneration();
    assert.deepEqual(calls, ["extract", "generate"]);
    assert.equal(r.created.length, 1);
    const a = articles.get(r.created[0]);
    assert.equal(a.checks.date.ok, true);
    assert.equal(a.flags.some((f) => f.type === "date_suspecte"), false);
  });

  test("date (M3-115) : sans date connue → génération inchangée", async () => {
    reset("Rochefort", LOCAL_SRC);
    const r = await runGeneration();
    assert.deepEqual(calls, ["extract", "generate"]);
    assert.equal(r.created.length, 1);
    assert.equal(articles.get(r.created[0]).checks.date.detected, null);
  });

  test("date (M3-115) : date ancienne citée au hasard du texte → généré, et toujours signalé à la finalisation", async () => {
    reset("Rochefort", LOCAL_SRC);
    setItem({ rawText: "Après la crue du 12 mars 2019, " + raw("Rochefort") });
    const r = await runGeneration();
    assert.deepEqual(calls, ["extract", "generate"]);
    const a = articles.get(r.created[0]);
    assert.equal(a.checks.date.reason, "trop_ancien");
    assert.ok(a.flags.some((f) => f.type === "date_suspecte" && /hors fenêtre de récupération/.test(f.detail)));
  });

  test("date (M3-115) : la fenêtre du réglage window_hours est respectée", async () => {
    reset("Rochefort", LOCAL_SRC);
    extraSettings = { window_hours: 24 * 30 };
    setItem({ publishedAt: ilYa(20) });
    const r = await runGeneration();
    assert.deepEqual(calls, ["extract", "generate"], "20 jours < 30 j + 7 j : dans la fenêtre");
    assert.equal(r.created.length, 1);
  });

  /* T14 — anti-régénération : un contenu source qui a déjà donné un article
     (vivant, purgé ou effacé, cf. test/purgeErase.test.js) n'est plus régénéré,
     même après réarmement de la récolte. */
  test("anti-régénération (T14) : contenu déjà généré → écarté avant tout appel, même réarmé", async () => {
    reset("Rochefort", LOCAL_SRC);
    dejaGeneres = new Set(["h1"]);
    const r = await runGeneration();
    assert.deepEqual(calls, [], "ni extraction ni génération");
    assert.equal(r.created.length, 0);
    assert.deepEqual(r.skipped.map((x) => x.reason), ["deja_genere"]);
    assert.equal(kv.get("harvest/latest.json").items[0].processed, true);

    /* Réarmement (comme clearArticles) : l'item repasse à processed:false. */
    const h = kv.get("harvest/latest.json"); h.items[0].processed = false; kv.set("harvest/latest.json", h);
    const r2 = await runGeneration();
    assert.deepEqual(calls, [], "toujours rien");
    assert.deepEqual(r2.skipped.map((x) => x.reason), ["deja_genere"]);
  });

  test("anti-régénération (T14) : purgé avec « autoriser la régénération » (clé libérée) → régénéré", async () => {
    reset("Rochefort", LOCAL_SRC);
    const r = await runGeneration();
    assert.deepEqual(calls, ["extract", "generate"]);
    assert.equal(r.created.length, 1);
    assert.equal(articles.get(r.created[0]).origin.harvestItemId, "h1", "la clé lue par le filtre est celle que l'article garde");
  });
}
