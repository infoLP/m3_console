/* Réglages texte facultatifs (M3-104) : la chaîne vide veut dire « rien de
   choisi » et doit passer le stockage ; les autres réglages texte la refusent
   toujours. */

import test from "node:test";
import assert from "node:assert/strict";

import { SETTING_SPECS, coerceSetting } from "../src/lib/yamlStore.js";

for (const k of ["llm_fallback_model", "llm_review_model"]) {
  test(`${k} : vide par défaut, chaîne vide acceptée, valeur gardée`, () => {
    assert.equal(SETTING_SPECS[k].default, "");
    assert.equal(coerceSetting(SETTING_SPECS[k], ""), "");
    assert.equal(coerceSetting(SETTING_SPECS[k], "   "), "");
    assert.equal(coerceSetting(SETTING_SPECS[k], " mistralai/mistral-small "), "mistralai/mistral-small");
  });
}

test("un réglage texte non facultatif refuse toujours la chaîne vide", () => {
  assert.throws(() => coerceSetting(SETTING_SPECS.llm_fallback_provider, ""), /valeur vide/);
});
