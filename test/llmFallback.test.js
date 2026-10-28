/* M3-88 — moteur de secours : quand le moteur principal échoue, l'appel est
   rejoué sur le second moteur du registre avant tout repli mock ; la bascule
   est tracée (llmStats.switch), la run reste ensuite sur le secours, et le
   plafond de dépense est revérifié avant de le solliciter.

   Aucun réseau : les moteurs parlent un dialecte de test (`fake`), posé par
   `__test.useEngines`. Les règles des Paramètres (M3-87) passent aussi par
   generateArticle, testé ici de bout en bout sur ces moteurs simulés. */

import test from "node:test";
import assert from "node:assert/strict";

import * as llm from "../src/llm/index.js";
import { tryEngines, engineIssue, fallbackIdOf, sameEngine, withModel } from "../src/llm/fallback.js";
import { SETTING_SPECS } from "../src/lib/yamlStore.js";

console.warn = () => {};   // échecs simulés : le journal du conteneur n'a rien à dire ici
/* Le relevé de dépense d'un appel simulé ne doit jamais atteindre une vraie base. */
delete process.env.DATABASE_URL;

const OR = "https://openrouter.ai/api/v1";   // exempté de liste blanche (M3-68)
const engine = (id) => ({ id, label: id.toUpperCase(), kind: "fake", baseUrl: OR, apiKey: "k", defaultModel: `${id}/model`, enabled: true });
const PRIMARY = engine("principal");
const SECOURS = engine("secours");

/* Chaque moteur répond selon `behaviour[id]` : une fonction (system, user) → objet JSON, ou lève. */
let behaviour = {};
let calls = [];
const fake = {
  chat: async (provider, system, user, opts) => {
    calls.push(provider.id);
    const b = behaviour[provider.id];
    if (typeof b !== "function") throw new Error(`HTTP 503 (${provider.id})`);
    if (opts.onUsage) opts.onUsage({ promptTokens: 100, completionTokens: 100, totalTokens: 200, cost: null, counted: true });
    return b(system, user);
  },
};
const use = (opts = {}) => { calls = []; llm.__test.useEngines({ adapters: { fake }, ...opts }); };
const plag = (score) => () => ({ score, verdict: "ok", spans: [] });

test("le réglage existe ; « aucun » ou vide = pas de secours", () => {
  assert.equal(SETTING_SPECS.llm_fallback_provider.default, "aucun");
  assert.equal(fallbackIdOf("aucun"), null);
  assert.equal(fallbackIdOf(" "), null);
  assert.equal(fallbackIdOf("openai"), "openai");
});

test("un secours inutilisable est écarté, avec son motif", () => {
  assert.equal(engineIssue(null), "moteur introuvable dans le registre");
  assert.equal(engineIssue({ ...SECOURS, enabled: false }), "moteur désactivé");
  assert.equal(engineIssue({ ...SECOURS, apiKey: "" }), "aucune clé d'API");
  assert.equal(engineIssue({ ...SECOURS, defaultModel: " " }), "aucun modèle choisi");
  assert.equal(engineIssue(SECOURS), null);
});

test("tryEngines : premier succès, échecs signalés, dernière erreur si tout échoue", async () => {
  const fails = [];
  const r = await tryEngines(["a", "b"], async (e) => { if (e === "a") throw new Error("x"); return e; }, { onFail: (e, err, next) => fails.push([e, next]) });
  assert.deepEqual(r, { value: "b", engine: "b", index: 1 });
  assert.deepEqual(fails, [["a", "b"]]);
  await assert.rejects(tryEngines(["a", "b"], async (e) => { throw new Error(`échec ${e}`); }), /échec b/);
});

test("principal en panne → le secours sert l'appel, la bascule est tracée", async () => {
  behaviour = { secours: plag(0.2) };
  use({ primary: PRIMARY, fallback: SECOURS });
  const r = await llm.checkPlagiarism("source", "article");
  assert.equal(r.score, 0.2, "réponse du secours, pas du mock");
  assert.deepEqual(calls, ["principal", "secours"]);
  assert.equal(llm.llmStats.fallbacks, 0, "aucun repli mock");
  assert.equal(llm.llmStats.secoursCalls, 1);
  assert.equal(llm.llmStats.switch.from.id, "principal");
  assert.equal(llm.llmStats.switch.to.id, "secours");
  assert.match(llm.llmStats.switch.error, /503/);
});

test("après la bascule, la run reste sur le secours", async () => {
  behaviour = { secours: plag(0.3) };
  use({ primary: PRIMARY, fallback: SECOURS });
  await llm.checkPlagiarism("s", "a");
  calls = [];
  await llm.checkPlagiarism("s", "a");
  assert.deepEqual(calls, ["secours"], "le principal en panne n'est pas repayé à chaque appel");
  assert.equal(llm.llmStats.secoursCalls, 2);
});

test("principal sain → le secours n'est jamais appelé", async () => {
  behaviour = { principal: plag(0.1), secours: plag(0.9) };
  use({ primary: PRIMARY, fallback: SECOURS });
  const r = await llm.checkPlagiarism("s", "a");
  assert.equal(r.score, 0.1);
  assert.deepEqual(calls, ["principal"]);
  assert.equal(llm.llmStats.switch, null);
});

test("les deux en panne → repli mock compté, erreur du dernier moteur", async () => {
  behaviour = {};
  use({ primary: PRIMARY, fallback: SECOURS });
  await llm.checkPlagiarism("source identique", "source identique");
  assert.deepEqual(calls, ["principal", "secours"]);
  assert.equal(llm.llmStats.fallbacks, 1);
  assert.match(llm.llmStats.lastError, /secours/);
});

test("sans secours : repli mock direct, comme avant M3-88", async () => {
  behaviour = {};
  use({ primary: PRIMARY });
  await llm.checkPlagiarism("s", "a");
  assert.deepEqual(calls, ["principal"]);
  assert.equal(llm.llmStats.fallbacks, 1);
  assert.equal(llm.llmStats.switch, null);
});

test("plafond atteint par le principal → le secours n'est pas sollicité", async () => {
  /* Le principal consomme 200 tokens puis échoue ; plafond de run à 100 tokens. */
  behaviour = { principal: () => { throw new Error("réponse illisible"); }, secours: plag(0.5) };
  const failing = { ...fake, chat: async (p, s, u, o) => { calls.push(p.id); o.onUsage({ promptTokens: 100, completionTokens: 100, totalTokens: 200, cost: null, counted: true }); return behaviour[p.id](s, u); } };
  calls = [];
  llm.__test.useEngines({ primary: PRIMARY, fallback: SECOURS, adapters: { fake: failing }, settings: { llm_cap_run_tokens: 100, llm_cap_action: "stop" } });
  await assert.rejects(llm.checkPlagiarism("s", "a"), (err) => err.code === "LLM_CAP");
  assert.deepEqual(calls, ["principal"]);
  assert.ok(llm.llmStats.capHit);
});

test("génération de bout en bout : bascule ET règles tenues (M3-87)", async () => {
  const ok = { title: "Rochefort ouvre une médiathèque", chapo: "C.", body: [{ type: "p", text: "x".repeat(900) }],
    category: "Culture", suggested_ranking: 70, seo: { metaTitle: "Rochefort", metaDescription: "d".repeat(100), slug: "rochefort", keywords: ["a", "b", "c"] } };
  let n = 0;
  behaviour = { secours: (system, user) => (n++ === 0 ? { ...ok, title: "t".repeat(200) } : (assert.match(user, /CORRECTION OBLIGATOIRE/), ok)) };
  use({ primary: PRIMARY, fallback: SECOURS });
  const gen = await llm.generateArticle({ title_hint: "x", facts: [] }, { rules: { rules_retry_max: 1, length_source_pct: 0 } });
  assert.deepEqual(calls, ["principal", "secours", "secours"], "panne, secours, relance pour le titre");
  assert.equal(gen.title, ok.title);
  assert.equal(gen.ruleCheck.attempts, 2);
  assert.deepEqual(gen.ruleCheck.violations, []);
  assert.equal(llm.llmStats.ruleRetries, 1);
});

/* Moteur + modèle (M3-88, M3-89) : le secours peut être le moteur actif
   lui-même, appelé avec un autre modèle — même clé, rien à ressaisir. */
test("withModel : le modèle réglé surcharge celui du moteur ; vide = celui du moteur", () => {
  assert.equal(withModel(PRIMARY, "openai/luna").defaultModel, "openai/luna");
  assert.equal(withModel(PRIMARY, "openai/luna").apiKey, "k", "même clé");
  assert.equal(withModel(PRIMARY, " ").defaultModel, "principal/model");
  assert.equal(withModel(PRIMARY, undefined), PRIMARY);
  assert.equal(withModel(null, "x"), null);
});

test("sameEngine : même moteur ET même modèle seulement", () => {
  assert.equal(sameEngine(PRIMARY, { ...PRIMARY }), true);
  assert.equal(sameEngine(PRIMARY, withModel(PRIMARY, "openai/luna")), false);
  assert.equal(sameEngine(PRIMARY, SECOURS), false);
  assert.equal(sameEngine(PRIMARY, null), false);
});

test("même moteur, autre modèle : le secours rejoue l'appel avec SON modèle", async () => {
  const models = [];
  const parModele = {
    chat: async (provider, system, user, opts) => {
      models.push(opts.model);
      if (opts.model === "principal/model") throw new Error("HTTP 429 (mistral)");
      return plag(0.4)();
    },
  };
  llm.__test.useEngines({ adapters: { fake: parModele }, primary: PRIMARY, fallback: withModel(PRIMARY, "openai/luna") });
  const r = await llm.checkPlagiarism("s", "a");
  assert.equal(r.score, 0.4, "réponse du secours, pas du mock");
  assert.deepEqual(models, ["principal/model", "openai/luna"]);
  assert.equal(llm.llmStats.secoursCalls, 1);
  assert.equal(llm.llmStats.switch.from.model, "principal/model");
  assert.equal(llm.llmStats.switch.to.model, "openai/luna");
});
