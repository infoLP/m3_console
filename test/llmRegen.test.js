/* M3-55 — relances sur hallucination : quand la relecture automatique (M3-89)
   rejette un article, il est redemandé aux moteurs de llm_regen_engines, dans
   l'ordre, avec le verdict en recadrage, au plus llm_regen_max fois. Suite
   complète (src/generate/relance.js) sur de vrais appels de src/llm/index.js,
   moteurs simulés : aucun réseau, aucune base. */

import test from "node:test";
import assert from "node:assert/strict";

import * as llm from "../src/llm/index.js";
import { genererEtRelire, declencheRelance, planRelance, notificationHallucination } from "../src/generate/relance.js";
import { recadragePrompt } from "../src/llm/prompts/review.js";
import { DEFAULT_TEMPLATE } from "../src/llm/prompts/template.js";

console.warn = () => {};
delete process.env.DATABASE_URL;   // le relevé de dépense simulé n'atteint jamais une vraie base

const OR = "https://openrouter.ai/api/v1";   // exempté de liste blanche (M3-68)
const engine = (id, extra = {}) => ({ id, label: id.toUpperCase(), kind: "fake", baseUrl: OR, apiKey: "k", defaultModel: `${id}/model`, enabled: true, ...extra });
const PRIMARY = engine("principal");
const REVIEWER = engine("relecteur");
const REGISTRY = {
  principal: PRIMARY, alpha: engine("alpha"), beta: engine("beta"), gamma: engine("gamma"),
  sansclef: engine("sansclef", { apiKey: "" }),
  openrouter: engine("openrouter"),
};

const SOURCE = "La commune de Rochefort ouvre sa médiathèque le 12 octobre. Les travaux ont coûté 3 millions d'euros. ".repeat(4);
const ARTICLE = (title) => ({
  title, chapo: "La médiathèque ouvre le 12 octobre.", body: [{ type: "p", text: "Les travaux ont coûté 3 millions d'euros. ".repeat(20) }],
  category: "Culture", suggested_ranking: 70, seo: { metaTitle: "Rochefort", metaDescription: "d".repeat(100), slug: "rochefort", keywords: ["a", "b", "c"] },
});
const REJET = (n) => ({ verdict: "rejet", hallucinations: Array.from({ length: n }, (_, i) => ({ extrait: `${4 + i} millions`, explication: "la source dit 3 millions" })), resume: `${n} chiffre(s) inventé(s).`, suggestion_prompt: "Ne citer que les montants de la source." });
const OK = { verdict: "ok", hallucinations: [], resume: "Fidèle." };
const A_CORRIGER = { verdict: "a_corriger", hallucinations: [], fautes: [{ extrait: "medatheque", correction: "médiathèque" }], resume: "Une faute." };

/* Les moteurs de génération répondent un article titré à leur nom ; le
   relecteur dépile `reviews`. Chaque appel est noté. */
let reviews = [];
let calls = [];
let gens = [];
const fake = {
  chat: async (provider, system, user, opts) => {
    calls.push(provider.id);
    opts.onUsage?.({ promptTokens: 100, completionTokens: 100, totalTokens: 200, cost: null, counted: true });
    if (provider.id === "relecteur") return reviews.shift() || OK;
    gens.push({ id: provider.id, model: opts.model, user });
    return ARTICLE(`Rochefort ouvre sa médiathèque (${provider.id})`);
  },
};

const use = ({ review = REVIEWER, settings = {}, prompts = [], verdicts = [] } = {}) => {
  reviews = [...verdicts]; calls = []; gens = [];
  llm.__test.useEngines({ primary: PRIMARY, review, adapters: { fake }, settings, prompts, registry: REGISTRY });
};

const EXTRACTED = { title_hint: "Rochefort ouvre sa médiathèque", facts: ["Ouverture le 12 octobre."], locality: "Rochefort" };
const run = (regen = {}) => genererEtRelire({
  extracted: EXTRACTED, rawText: SOURCE,
  genOpts: { mode: "official", region: "Charente-Maritime", rules: { rules_retry_max: 0, length_source_pct: 0 } },
  finalizeCtx: { rawText: SOURCE, publishedAt: null, sourceZone: {}, extractedLocality: "Rochefort", titleHint: EXTRACTED.title_hint, settings: {} },
  plagiarism: false,
  settings: { llm_regen_max: 2, llm_regen_engines: "alpha, beta:beta/fort", ...regen },
  source: { name: "Mairie de Rochefort", url: "https://rochefort.fr/a" },
});
const genIds = () => gens.map((g) => g.id);

test("règle de déclenchement : rejet ou hallucination listée ; « à corriger » et relecture manquée, non", () => {
  assert.equal(declencheRelance({ status: "fait", verdict: "rejet", hallucinations: [] }), true, "contresens");
  assert.equal(declencheRelance({ status: "fait", verdict: "a_corriger", hallucinations: [{ extrait: "x" }] }), true);
  assert.equal(declencheRelance({ status: "fait", verdict: "a_corriger", hallucinations: [] }), false);
  assert.equal(declencheRelance({ status: "plafond" }), false);
  assert.equal(declencheRelance(null), false);
});

test("plan : liste ordonnée « moteur:modèle », seul le premier « : » sépare", () => {
  assert.deepEqual(planRelance({ llm_regen_max: 2, llm_regen_engines: " alpha , beta:meta/llama:free;gamma" }), {
    max: 2, engines: [{ id: "alpha", model: null }, { id: "beta", model: "meta/llama:free" }, { id: "gamma", model: null }],
  });
  assert.deepEqual(planRelance({}), { max: 0, engines: [] });
});

test("rejet → relance sur le 1er moteur de la liste, recadrage dans le prompt ; succès à la 2e", async () => {
  use({ verdicts: [REJET(1), OK] });
  const r = await run();
  assert.deepEqual(genIds(), ["principal", "alpha"]);
  assert.ok(!gens[0].user.includes("RECADRAGE"), "la première génération n'est pas recadrée");
  assert.match(gens[1].user, /RECADRAGE OBLIGATOIRE/);
  assert.match(gens[1].user, /« 4 millions » : la source dit 3 millions/);
  assert.match(gens[1].user, /Ne citer que les montants de la source/);
  assert.ok(gens[1].user.indexOf("RECADRAGE") > gens[1].user.indexOf("FORMAT"), "ajouté APRÈS le prompt rendu");
  assert.equal(r.gen.title, "Rochefort ouvre sa médiathèque (alpha)");
  assert.equal(r.review.verdict, "ok");
  assert.deepEqual(r.moteur, { id: "alpha", model: "alpha/model" });
  assert.equal(r.regen.issue, "ok");
  assert.equal(r.regen.retenue, 1);
  assert.deepEqual(r.regen.tentatives.map((t) => [t.moteur, t.verdict, t.hallucinations]), [["principal", "rejet", 1], ["alpha", "ok", 0]]);
  assert.equal(r.flags.length, 0, "la version retenue n'est pas signalée");
  assert.equal(r.gen.prompt.provider, "alpha");
  const R = llm.llmStats.regen;
  assert.deepEqual([R.articles, R.relances, R.reussies, R.persistantes], [1, 1, 1, 0]);
  assert.deepEqual(R.suggestions, ["Ne citer que les montants de la source."]);
  assert.equal(R.diagnostics[0].vers, "alpha");
});

test("échec persistant : n respecté, version au moins d'hallucinations gardée, signalée, notification", async () => {
  use({ verdicts: [REJET(2), REJET(1), REJET(3)] });
  const r = await run({ llm_regen_engines: "alpha, beta, gamma" });
  assert.deepEqual(genIds(), ["principal", "alpha", "beta"], "llm_regen_max = 2 : gamma n'est pas appelé");
  assert.equal(r.regen.issue, "hallucination_persistante");
  assert.equal(r.regen.retenue, 1, "alpha : 1 hallucination, contre 2 et 3");
  assert.equal(r.gen.title, "Rochefort ouvre sa médiathèque (alpha)");
  assert.equal(r.moteur.id, "alpha");
  const flag = r.flags.find((f) => f.type === "relecture_llm");
  assert.ok(flag, "drapeau relecture_llm gardé → article signalé");
  assert.match(flag.detail, /Persistant après 2 relance/);
  assert.equal(llm.llmStats.regen.persistantes, 1);
  // version du recadrage : celle de la relecture PRÉCÉDENTE
  assert.match(gens[2].user, /« 4 millions »/);
  assert.ok(!gens[2].user.includes("« 5 millions »"), "beta reçoit le verdict d'alpha (1 hallucination), pas celui du principal");
  const n = notificationHallucination({ articleId: "art-1", sourceId: "s1", sourceName: "Mairie de Rochefort", url: "https://rochefort.fr/a", regen: r.regen, review: r.review });
  assert.equal(n.type, "llm_hallucination");
  assert.equal(n.articleId, "art-1");
  assert.match(n.detail, /art-1/);
  assert.match(n.detail, /Mairie de Rochefort/);
  assert.match(n.detail, /https:\/\/rochefort\.fr\/a/);
  assert.match(n.detail, /« 4 millions »/);
  assert.match(n.detail, /n° 2 sur 3/);
});

test("à égalité d'hallucinations, la plus récente est gardée", async () => {
  use({ verdicts: [REJET(1), REJET(1), REJET(1)] });
  const r = await run();
  assert.equal(r.regen.retenue, 2);
  assert.equal(r.moteur.id, "beta");
});

test("liste vide → aucune relance, comportement d'avant", async () => {
  use({ verdicts: [REJET(1)] });
  const r = await run({ llm_regen_engines: "" });
  assert.deepEqual(calls, ["principal", "relecteur"]);
  assert.equal(r.regen, null);
  assert.equal(r.moteur, null);
  assert.deepEqual(r.flags.map((f) => f.type), ["relecture_llm"]);
  assert.doesNotMatch(r.flags[0].detail, /Persistant/);
  assert.equal(llm.llmStats.regen.articles, 0);
});

test("llm_regen_max = 0 ou relecture désactivée → aucune relance", async () => {
  use({ verdicts: [REJET(1)] });
  assert.equal((await run({ llm_regen_max: 0 })).regen, null);
  assert.deepEqual(genIds(), ["principal"]);
  use({ review: null });
  const r = await run();
  assert.equal(r.review, null);
  assert.equal(r.regen, null);
  assert.deepEqual(calls, ["principal"]);
});

test("« à corriger » ne relance pas", async () => {
  use({ verdicts: [A_CORRIGER] });
  const r = await run();
  assert.deepEqual(genIds(), ["principal"]);
  assert.equal(r.regen, null);
  assert.equal(r.flags.length, 0);
});

test("moteur de la liste inutilisable : sauté avec son motif, le suivant sert", async () => {
  use({ verdicts: [REJET(1), OK] });
  const r = await run({ llm_regen_engines: "inconnu, sansclef, mock, principal, alpha", llm_regen_max: 1 });
  assert.deepEqual(genIds(), ["principal", "alpha"], "un moteur sauté ne consomme pas de relance");
  assert.deepEqual(r.regen.tentatives.slice(1, 5).map((t) => t.motif), [
    "sauté : moteur introuvable dans le registre",
    "sauté : aucune clé d'API",
    "sauté : le mock n'est pas un moteur de génération réel",
    "sauté : même moteur et même modèle que la version rejetée",
  ]);
  assert.equal(r.regen.issue, "ok");
  assert.equal(r.regen.retenue, 5);
  assert.equal(llm.llmStats.regen.sautes, 4);
});

test("routeur en tête de liste : sauté (modèle variable), le suivant sert", async () => {
  use({ verdicts: [REJET(1), OK] });
  const r = await run({ llm_regen_engines: "openrouter:openrouter/auto, alpha" });
  assert.deepEqual(genIds(), ["principal", "alpha"]);
  assert.equal(r.regen.tentatives[1].motif, "sauté : modèle variable (routeur) : exclu des relances");
  assert.equal(r.moteur.id, "alpha");
});

test("aucun moteur utilisable → « aucune_relance », article signalé comme avant", async () => {
  use({ verdicts: [REJET(1)] });
  const r = await run({ llm_regen_engines: "sansclef" });
  assert.deepEqual(genIds(), ["principal"]);
  assert.equal(r.regen.issue, "aucune_relance");
  assert.equal(r.regen.retenue, 0);
  assert.deepEqual(r.flags.map((f) => f.type), ["relecture_llm"]);
});

test("plafond de dépense atteint → arrêt propre, la version payée reste", async () => {
  /* Génération 200 + relecture 200 = 400 tokens ≥ 300 : la relance ne part pas. */
  use({ verdicts: [REJET(1)], settings: { llm_cap_run_tokens: 300, llm_cap_action: "stop" } });
  const r = await run();
  assert.deepEqual(genIds(), ["principal"], "aucun appel de relance");
  assert.match(r.regen.tentatives[1].motif, /^plafond : /);
  assert.equal(r.regen.tentatives.length, 2, "on ne passe pas au moteur suivant");
  assert.equal(r.regen.issue, "aucune_relance");
  assert.equal(r.gen.title, "Rochefort ouvre sa médiathèque (principal)");
  assert.ok(llm.llmStats.capHit);
  assert.equal(llm.llmStats.regen.arrets, 1);
});

test("le prompt de la table llm_prompts propre au moteur de relance s'applique", async () => {
  const marque = (m) => `${m}\n${DEFAULT_TEMPLATE}`;
  use({
    verdicts: [REJET(1), OK],
    prompts: [
      { id: "1", providerId: "principal", model: null, template: marque("PROMPT-PRINCIPAL"), version: 1 },
      { id: "2", providerId: "alpha", model: null, template: marque("PROMPT-ALPHA"), version: 4 },
    ],
  });
  const r = await run();
  assert.match(gens[0].user, /^PROMPT-PRINCIPAL/);
  assert.match(gens[1].user, /^PROMPT-ALPHA/);
  assert.match(gens[1].user, /RECADRAGE OBLIGATOIRE/);
  assert.deepEqual([r.gen.prompt.id, r.gen.prompt.scope, r.gen.prompt.version, r.gen.prompt.provider], ["2", "moteur", 4, "alpha"]);
});

test("moteur imposé : son modèle réglé, sans secours ni repli mock s'il tombe", async () => {
  use();
  const g = await llm.generateArticle(EXTRACTED, { rules: { rules_retry_max: 0 }, engine: "beta:beta/fort" });
  assert.deepEqual(gens.map((x) => [x.id, x.model]), [["beta", "beta/fort"]]);
  assert.equal(g.prompt.model, "beta/fort");
  await assert.rejects(llm.generateArticle(EXTRACTED, { engine: "sansclef" }), (e) => e.code === "LLM_ENGINE_UNUSABLE" && /aucune clé/.test(e.message));
  const panne = { chat: async () => { throw new Error("HTTP 503"); } };
  llm.__test.useEngines({ primary: PRIMARY, adapters: { fake: panne }, registry: REGISTRY });
  await assert.rejects(llm.generateArticle(EXTRACTED, { engine: "alpha" }), /503/);
  assert.equal(llm.llmStats.fallbacks, 0, "pas de repli mock");
});

test("recadrage : verdict, passages, diagnostic et consigne", () => {
  const p = recadragePrompt({ verdict: "rejet", hallucinations: [{ extrait: "4 millions", explication: "3 millions" }], resume: "Chiffre inventé.", suggestionPrompt: "Citer les montants exacts." });
  assert.match(p, /verdict : rejet/);
  assert.match(p, /« 4 millions » : 3 millions/);
  assert.match(p, /Diagnostic : Chiffre inventé\./);
  assert.match(p, /Consigne : Citer les montants exacts\./);
});
