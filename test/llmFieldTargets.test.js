/* M3-86 (titres et méta) et M3-56 (prompt par moteur), branchés dans
   generateArticle : les fenêtres du titre et de la méta sont calculées sur les
   mesures de la source gardées à l'extraction, citées au modèle, contrôlées
   (relance si le titre sort de sa fenêtre) et rendues avec l'article ; le
   prompt qui a servi est tracé. Aucun réseau : moteur simulé. */

import test from "node:test";
import assert from "node:assert/strict";

import * as llm from "../src/llm/index.js";

console.warn = () => {};
delete process.env.DATABASE_URL;

const OR = "https://openrouter.ai/api/v1";   // exempté de liste blanche (M3-68)
const PRIMARY = { id: "or", label: "OR", kind: "fake", baseUrl: OR, apiKey: "k", defaultModel: "or/model", enabled: true };

const extracted = {
  facts: ["La médiathèque de Rochefort ouvre le 3 novembre."], quotes: [], entities: [], locality: "Rochefort",
  source_signs: 1200, source_title_chars: 50, source_lead_chars: 140,
};
const article = (title) => ({
  title, chapo: "La médiathèque ouvre ses portes.",
  body: [{ type: "p", text: "x ".repeat(600) }],
  category: "Culture", suggested_ranking: 60, ranking_reason: "local",
  seo: { metaTitle: "Rochefort : la médiathèque ouvre", metaDescription: "m".repeat(120), slug: "rochefort-mediatheque-ouvre", keywords: ["a", "b", "c"] },
});

test("titre hors de sa fenêtre : cité au modèle, redemandé, fenêtre rendue avec l'article", async () => {
  const prompts = [];
  let n = 0;
  const fake = {
    chat: async (provider, system, user) => {
      prompts.push(user);
      n++;
      /* 1re réponse : titre de 12 caractères, sous la fenêtre ; 2e : 50. */
      return article(n === 1 ? "Court titre." : "Rochefort ouvre sa nouvelle médiathèque le 3 nov");
    },
  };
  llm.__test.useEngines({ adapters: { fake }, primary: PRIMARY, settings: {} });
  const gen = await llm.generateArticle(extracted, { rules: { title_source_pct: 100, rules_retry_max: 1 } });
  assert.ok(gen.fieldTargets?.title, "fenêtre du titre calculée");
  assert.equal(gen.fieldTargets.title.target, 50, "100 % du titre de la source");
  assert.equal(gen.fieldTargets.metaDesc, null, "méta à 0 % : règle d'avant");
  assert.match(prompts[0], /environ 50 caractères/, "la fenêtre est citée au modèle");
  assert.equal(n, 2, "le titre trop court a été redemandé");
  assert.equal(gen.ruleCheck.attempts, 2);
});

test("pourcentages à 0 : aucune fenêtre, texte du titre d'avant", async () => {
  const prompts = [];
  const fake = { chat: async (p, s, user) => { prompts.push(user); return article("Rochefort ouvre sa nouvelle médiathèque"); } };
  llm.__test.useEngines({ adapters: { fake }, primary: PRIMARY, settings: {} });
  const gen = await llm.generateArticle(extracted, { rules: {} });
  assert.deepEqual(gen.fieldTargets, { title: null, metaTitle: null, metaDesc: null });
  assert.match(prompts[0], /≤ 90 caractères/);
});

test("le prompt qui a servi est tracé : surcharge du moteur, sinon défaut du code", async () => {
  const fake = { chat: async () => article("Rochefort ouvre sa nouvelle médiathèque") };
  llm.__test.useEngines({ adapters: { fake }, primary: PRIMARY });
  const def = await llm.generateArticle(extracted, { rules: {} });
  assert.equal(def.prompt.scope, "defaut");
  assert.equal(def.prompt.provider, "or");
  assert.equal(llm.llmStats.prompts.length, 1);
});
