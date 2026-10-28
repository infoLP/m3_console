/* M3-56 — règle du slug : 6 mots au plus, mots vides et dates retirés. Une seule
   fonction pour finalize (qui refait le slug) et checkRules (qui le contrôle). */

import test from "node:test";
import assert from "node:assert/strict";

import { slugify, slugRuleOk, slugRule, checkRules, rulesOf } from "../src/llm/rules.js";
import { finalizeGenerated } from "../src/generate/finalize.js";

const R = rulesOf({});

test("6 mots au plus, mots vides retirés, sans accent", () => {
  assert.equal(slugify("La mairie de Rochefort ouvre une médiathèque pour les enfants de la ville", R), "mairie-rochefort-ouvre-mediatheque-enfants-ville");
  assert.equal(slugify("Écoles : l'État finance des cantines à Châtellerault et à Poitiers cette année", R).split("-").length, 6);
});

test("dates retirées : année, jour + mois, jour de la semaine + nombre", () => {
  assert.equal(slugify("Fête du port le 14 octobre 2026 à La Rochelle", R), "fete-port-rochelle");
  assert.equal(slugify("Concert lundi 12 à Niort", R), "concert-niort");
  assert.equal(slugify("Marché de Noël 2026 ouvert", R), "marche-noel-ouvert");
  assert.equal(slugify("Octobre rose : 2 millions d'euros", R), "octobre-rose-2-millions-euros", "mois seul et nombre isolé restent");
});

test("slug_max_words = 0 : sans limite, mais mots vides et dates toujours écartés", () => {
  const s = slugify("Le conseil municipal de Rochefort vote le budget des écoles primaires et des crèches en 2026", { slug_max_words: 0 });
  assert.equal(s, "conseil-municipal-rochefort-vote-budget-ecoles-primaires-creches");
});

test("texte vide ou entièrement vide de sens : « article »", () => {
  assert.equal(slugify("Le de la", R), "article");
  assert.equal(slugify("", R), "article");
});

test("slugRuleOk : format, nombre de mots, mots vides, dates", () => {
  assert.equal(slugRuleOk("mairie-rochefort-mediatheque", R), true);
  assert.equal(slugRuleOk("mairie-de-rochefort", R), false, "mot vide");
  assert.equal(slugRuleOk("b1-b2-b3-b4-b5-b6", R), true, "6 mots");
  assert.equal(slugRuleOk("b1-b2-b3-b4-b5-b6-b7", R), false, "7 mots");
  assert.equal(slugRuleOk("fete-14-octobre", R), false, "date");
  assert.equal(slugRuleOk("fete-2026", R), false, "année");
  assert.equal(slugRuleOk("Pas Bon", R), false, "format");
  assert.equal(slugRuleOk("b1-b2-b3-b4-b5-b6-b7", { slug_max_words: 0 }), true, "0 = sans limite");
});

test("un slug produit par slugify passe toujours slugRuleOk", () => {
  for (const t of ["Le 3 mars 2026, la préfecture de la Vienne publie un arrêté", "L'été à l'île de Ré", "2026", "Mardi 14 : jour de marché"]) {
    assert.equal(slugRuleOk(slugify(t, R), R), true, t);
  }
});

test("slugRule : consigne du prompt, avec ou sans nombre de mots", () => {
  assert.equal(slugRule(R), "Slug : 6 mots au plus, en minuscules, séparés par des tirets, sans accent, sans mot vide (le, de, à…) ni date.");
  assert.equal(slugRule({ slug_max_words: 0 }), "Slug : en minuscules, séparés par des tirets, sans accent, sans mot vide (le, de, à…) ni date.");
  assert.match(slugRule({ slug_max_words: 1 }), /^Slug : 1 mot au plus,/);
});

test("checkRules signale le slug hors règle, sans relance (finalize le refait)", () => {
  const g = { title: "Titre", chapo: "c", body: [{ type: "p", text: "a".repeat(900) }], seo: { metaTitle: "Titre", metaDescription: "m".repeat(100), slug: "la-mairie-de-rochefort-ouvre-une-mediatheque", keywords: ["a", "b", "c"] } };
  const v = checkRules(g, R).find((x) => x.rule === "slug");
  assert.ok(v);
  assert.equal(v.retry, false);
});

test("finalize refait un slug hors règle avec la même fonction", () => {
  const gen = {
    title: "La mairie de Rochefort ouvre une médiathèque pour les enfants",
    chapo: "Chapô.", body: [{ type: "p", text: "Texte de l'article sur la médiathèque de Rochefort." }],
    category: "Société",
    seo: { metaTitle: "Rochefort ouvre une médiathèque", metaDescription: "m".repeat(100), slug: "la-mairie-de-rochefort-ouvre-une-mediatheque-pour-les-enfants-14-octobre-2026", keywords: ["a", "b", "c"] },
  };
  finalizeGenerated(gen, { rawText: "", settings: {} });
  assert.equal(slugRuleOk(gen.seo.slug, R), true);
  assert.equal(gen.seo.slug, "mairie-rochefort-ouvre-mediatheque-enfants");
});

test("M3-113 : la définition vit dans shared/slug.js, rules.js la réexporte", async () => {
  const shared = await import("../shared/slug.js");
  const rules = await import("../src/llm/rules.js");
  assert.equal(rules.slugify, shared.slugify);
  assert.equal(rules.slugRuleOk, shared.slugRuleOk);
  assert.equal(rules.slugRuleDetail, shared.slugRuleDetail);
  assert.equal(rules.RULES_DEFAULTS.slug_max_words, shared.SLUG_MAX_WORDS);
  assert.equal(shared.slugRuleOk("parc-marin-gironde-estuaire-ouvre-saison-ete", R), false, "7 mots");
  assert.equal(shared.slugRuleOk("fete-de-la-ville", R), false, "mot vide");
});
