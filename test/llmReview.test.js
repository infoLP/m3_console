/* M3-89 — relecture automatique : chaque article généré comparé à sa source
   par un second moteur, verdict stocké. Réglable (activée ou non, moteur), coût
   borné par le plafond de dépense (M3-62). Aucun réseau : moteur simulé ou
   relecture mock. */

import test from "node:test";
import assert from "node:assert/strict";

import * as llm from "../src/llm/index.js";
import * as mock from "../src/llm/mock.js";
import { normalizeReview, userPrompt, SOURCE_MAX_CHARS, CLES_CONSIGNES } from "../src/llm/prompts/review.js";
import { SETTING_SPECS } from "../src/lib/yamlStore.js";

console.warn = () => {};
delete process.env.DATABASE_URL;   // le relevé de dépense simulé n'atteint jamais une vraie base

const OR = "https://openrouter.ai/api/v1";
const REVIEWER = { id: "relecteur", label: "Relecteur", kind: "fake", baseUrl: OR, apiKey: "k", defaultModel: "fort/modele", enabled: true };
const SOURCE = "La commune de Rochefort ouvre sa médiathèque le 12 octobre. Les travaux ont coûté 3 millions d'euros.";
const ARTICLE = { title: "Rochefort ouvre sa médiathèque", chapo: "Ouverture le 12 octobre.", body: [{ type: "p", text: "Les travaux ont coûté 3 millions d'euros." }] };

let answer = null;
let seen = [];
const fake = {
  chat: async (provider, system, user, opts) => {
    seen.push({ provider: provider.id, user, temperature: opts.temperature });
    opts.onUsage?.({ promptTokens: 300, completionTokens: 100, totalTokens: 400, cost: null, counted: true });
    if (answer instanceof Error) throw answer;
    return answer;
  },
};
const use = (review, settings = {}) => { seen = []; llm.__test.useEngines({ review, adapters: { fake }, settings }); };

test("réglages : désactivée par défaut, aucun moteur choisi", () => {
  assert.equal(SETTING_SPECS.llm_review_enabled.default, "non");
  assert.deepEqual(SETTING_SPECS.llm_review_enabled.values, ["non", "oui"]);
  assert.equal(SETTING_SPECS.llm_review_provider.default, "aucun");
});

test("le prompt porte la source et l'article ; une source trop longue est tronquée", () => {
  const p = userPrompt(SOURCE, ARTICLE);
  assert.ok(p.includes(SOURCE));
  assert.ok(p.includes("TITRE : Rochefort ouvre sa médiathèque"));
  assert.match(p, /HALLUCINATIONS/);
  assert.match(userPrompt("x".repeat(SOURCE_MAX_CHARS + 10), ARTICLE), /source tronquée/);
});

test("verdict borné : inconnu → à corriger, hallucination → rejet", () => {
  assert.equal(normalizeReview({ verdict: "parfait" }).verdict, "a_corriger");
  assert.equal(normalizeReview({ verdict: "ok", hallucinations: [{ extrait: "4 millions" }] }).verdict, "rejet");
  assert.equal(normalizeReview({ verdict: "ok", fidelite: 140 }).fidelite, 100);
  assert.equal(normalizeReview({}).fidelite, null);
  assert.equal(normalizeReview({ suggestion_prompt: "  Exiger  la date. " }).suggestionPrompt, "Exiger la date.");
});

test("désactivée → null, aucun appel", async () => {
  use(null);
  assert.equal(await llm.reviewArticle(SOURCE, ARTICLE), null);
  assert.equal(seen.length, 0);
});

test("moteur de relecture : verdict stocké, attribué, compté", async () => {
  answer = { verdict: "a_corriger", fidelite: 90, hallucinations: [], fautes: [{ extrait: "medatheque", correction: "médiathèque" }], resume: "Une faute.", suggestion_prompt: "Relire l'orthographe des lieux." };
  use(REVIEWER);
  const r = await llm.reviewArticle(SOURCE, ARTICLE);
  assert.equal(r.status, "fait");
  assert.equal(r.verdict, "a_corriger");
  assert.equal(r.engine, "relecteur");
  assert.equal(r.model, "fort/modele");
  assert.equal(r.fautes.length, 1);
  assert.ok(r.at);
  assert.equal(seen[0].temperature, 0);
  assert.equal(llm.llmStats.reviews.done, 1);
  assert.equal(llm.llmStats.reviews.a_corriger, 1);
  assert.deepEqual(llm.llmStats.reviews.suggestions, ["Relire l'orthographe des lieux."]);
  assert.equal(llm.llmStats.usage.totalTokens, 400, "le coût de la relecture compte dans la run (M3-62)");
});

test("relecture en échec → statut « echec », jamais d'exception ni de verdict inventé", async () => {
  answer = new Error("HTTP 500");
  use(REVIEWER);
  const r = await llm.reviewArticle(SOURCE, ARTICLE);
  assert.equal(r.status, "echec");
  assert.match(r.detail, /500/);
  assert.equal(r.verdict, undefined);
  assert.equal(llm.llmStats.reviews.failed, 1);
});

test("plafond de dépense atteint → pas de relecture", async () => {
  answer = { verdict: "ok" };
  use(REVIEWER, { llm_cap_run_tokens: 300 });
  await llm.reviewArticle(SOURCE, ARTICLE);        // 400 tokens : passe, et atteint le plafond
  const r = await llm.reviewArticle(SOURCE, ARTICLE);
  assert.equal(r.status, "plafond");
  assert.equal(seen.length, 1, "le second appel n'est pas parti");
  assert.equal(llm.llmStats.reviews.skipped, 1);
});

test("relecture mock : nombre absent de la source → rejet ; article fidèle → ok", async () => {
  const fidele = await mock.reviewArticle(SOURCE, ARTICLE);
  assert.equal(fidele.verdict, "ok");
  const invente = await mock.reviewArticle(SOURCE, { ...ARTICLE, chapo: "Ouverture le 14 octobre pour 1 500 lecteurs." });
  assert.equal(invente.verdict, "rejet");
  assert.deepEqual(invente.hallucinations.map((h) => h.extrait).sort(), ["14", "1500"].sort());
});

test("moteur « mock » réglé : relecture mécanique, sans appel au réseau", async () => {
  use("mock");
  answer = new Error("ne doit pas partir");
  const r = await llm.reviewArticle(SOURCE, ARTICLE);
  assert.equal(r.status, "fait");
  assert.equal(r.verdict, "ok");
  assert.equal(r.engine, "mock");
  assert.equal(seen.length, 0);
});
/* M3-113, lot D : un verdict par consigne de rédaction, ajouté sans rien
   changer au reste de la réponse. */
test("consignes : les 7 clés exportées et toutes dans le prompt", () => {
  assert.deepEqual(CLES_CONSIGNES, ["style_phrases_creuses", "chapo_factuel", "fin_concrete", "angle", "communique_non_explique", "date_redigee", "partenaire_signale"]);
  const p = userPrompt(SOURCE, ARTICLE);
  for (const k of CLES_CONSIGNES) assert.ok(p.includes(k), k);
  assert.ok(p.includes(`"consignes": [{"cle"`));
});

test("consignes : analyse tolérante (absentes, clé inconnue, ok invalide, doublon)", () => {
  assert.equal("consignes" in normalizeReview({ verdict: "ok" }), false, "sans consignes : rien d'ajouté");
  assert.equal("consignes" in normalizeReview({ verdict: "ok", consignes: "oui" }), false);
  assert.equal("consignes" in normalizeReview({ verdict: "ok", consignes: [{ cle: "inconnue", ok: false }] }), false);
  const r = normalizeReview({ verdict: "ok", consignes: [
    { cle: "inconnue", ok: false }, { cle: "fin_concrete", ok: false, extrait: "  L'avenir   dira. " },
    { cle: "angle", ok: "oui" }, { cle: "chapo_factuel", ok: true, extrait: "ignoré" }, { cle: "fin_concrete", ok: true }, null,
  ] });
  assert.equal(r.verdict, "ok", "les consignes ne touchent pas au verdict");
  assert.deepEqual(r.consignes, [
    { cle: "chapo_factuel", ok: true }, { cle: "fin_concrete", ok: false, extrait: "L'avenir dira." }, { cle: "angle", ok: null },
  ]);
});

test("consignes : stockées dans le résultat de la relecture (checks.review.consignes)", async () => {
  answer = { verdict: "ok", consignes: [{ cle: "date_redigee", ok: false, extrait: "récemment" }, { cle: "partenaire_signale", ok: null }, { cle: "x", ok: true }] };
  use(REVIEWER);
  const r = await llm.reviewArticle(SOURCE, ARTICLE);
  assert.equal(r.status, "fait");
  assert.deepEqual(r.consignes, [{ cle: "date_redigee", ok: false, extrait: "récemment" }, { cle: "partenaire_signale", ok: null }]);
  answer = { verdict: "ok" };
  use(REVIEWER);
  assert.equal((await llm.reviewArticle(SOURCE, ARTICLE)).consignes, undefined);
});
