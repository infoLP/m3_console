/* Les contraintes chiffrées du prompt de génération viennent des réglages
   (onglet Paramètres) depuis le 2026-10-12, et non plus du texte. Ce qui compte :
   - sans réglage, le texte reçu par les modèles ne change pas ;
   - chaque réglage atteint le prompt, aucun chiffre n'y reste écrit en dur ;
   - la grille (shared/scoring.js) lit la même valeur que le prompt. */

import test from "node:test";
import assert from "node:assert/strict";

import { userPrompt } from "../src/llm/prompts/generate.js";
import { DEFAULT_SETTINGS, PROMPT_DEFAULTS, asBlocks } from "../shared/model.js";
import { seoComplete } from "../shared/scoring.js";

const ODD = {
  ...DEFAULT_SETTINGS, ...PROMPT_DEFAULTS,
  title_max: 77, h2_title_max: 55, breve_signs_min: 450, h2_above_signs: 2000,
  signs_max: 9000, meta_title_max: 55, meta_desc_min: 80, meta_desc_max: 150,
  keywords_min: 5, outline_h2_min: 2,
};

test("réglages par défaut : texte inchangé", () => {
  const defaults = { ...DEFAULT_SETTINGS, ...PROMPT_DEFAULTS };
  assert.equal(userPrompt({}, { mode: "source" }), userPrompt({}, { mode: "source", rules: defaults }));
  const p = userPrompt({}, {});
  assert.ok(p.includes("≤ 90 caractères. JAMAIS"));
  assert.ok(p.includes("600 à 1 500 signes (1 à 2 paragraphes). Sinon, 600 à 7 000 signes."));
  assert.ok(p.includes("Au-delà de 1 500 signes, place au moins un h2 ; un h2 tous les 2 à 4"));
  assert.ok(p.includes("Balise titre ≤ 60 caractères, méta-description entre 70 et 160 caractères."));
  assert.ok(p.includes("Au moins 3 mots-clés."));
});

test("chaque réglage atteint le prompt", () => {
  const p = userPrompt({}, { rules: ODD });
  assert.ok(p.includes("avec un verbe, ≤ 77 caractères"), "title_max");
  assert.ok(p.includes("Un intertitre est court (≤ 55 caractères)"), "h2_title_max");
  assert.ok(p.includes("450 à 2 000 signes (1 à 2 paragraphes). Sinon, 450 à 9 000 signes."), "brève, seuil H2, signs_max");
  assert.ok(p.includes("Au-delà de 2 000 signes, place au moins 2 h2"), "h2_above_signs, outline_h2_min");
  assert.ok(p.includes("Balise titre ≤ 55 caractères, méta-description entre 80 et 150 caractères."), "méta");
  assert.ok(p.includes("Au moins 5 mots-clés."), "keywords_min");
});

test("plus aucune valeur par défaut écrite en dur", () => {
  const p = userPrompt({}, { rules: ODD });
  for (const old of ["90 caractères", "1 500", "7 000", "≤ 70", "≤ 60", "entre 70 et 160", "Au moins 3", "600 à"]) {
    assert.ok(!p.includes(old), `reste « ${old} »`);
  }
});

test("outline_h2_min à 0 : le prompt n'exige plus d'intertitre, comme la grille", () => {
  const p = userPrompt({}, { rules: { outline_h2_min: 0 } });
  assert.ok(p.includes("Au-delà de 1 500 signes, les intertitres sont facultatifs"));
  assert.ok(!p.includes("place au moins"));
});

test("des réglages contradictoires sont refusés à l'enregistrement", async () => {
  const { checkCoherence, SETTING_SPECS } = await import("../src/lib/yamlStore.js");
  const defaults = Object.fromEntries(Object.entries(SETTING_SPECS).map(([k, s]) => [k, s.default]));
  assert.doesNotThrow(() => checkCoherence(defaults), "les défauts sont cohérents");
  assert.throws(() => checkCoherence({ ...defaults, breve_signs_min: 1500 }), /breve_signs_min/);
  assert.throws(() => checkCoherence({ ...defaults, h2_above_signs: 8000 }), /h2_above_signs/);
  assert.throws(() => checkCoherence({ ...defaults, meta_desc_min: 160 }), (e) => e.status === 400 && /meta_desc_min/.test(e.message));
});

test("la grille suit le même seuil h2_above_signs que le prompt", () => {
  const SEO = { metaTitle: "Titre", metaDescription: "d".repeat(100), slug: "s", keywords: ["a", "b", "c"] };
  const a = { title: "T", seo: SEO, body: asBlocks(["x".repeat(1800)]) };
  assert.equal(seoComplete(a, { ...DEFAULT_SETTINGS }).olOK, false, "1 800 > 1 500 : H2 exigé par défaut");
  assert.equal(seoComplete(a, { ...DEFAULT_SETTINGS, h2_above_signs: 2000 }).olOK, true, "seuil relevé : brève");
});
