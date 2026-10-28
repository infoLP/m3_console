/* Réglages de R4 (M3-55, M3-56, M3-86) : défauts qui ne changent rien tant que
   l'utilisateur n'a rien choisi, et contrôles croisés min < max. */

import test from "node:test";
import assert from "node:assert/strict";

import { SETTING_SPECS, checkCoherence, coerceSetting } from "../src/lib/yamlStore.js";

const defauts = () => Object.fromEntries(Object.entries(SETTING_SPECS).map(([k, s]) => [k, s.default]));

test("les défauts passent les contrôles croisés", () => {
  assert.doesNotThrow(() => checkCoherence(defauts()));
});

test("pourcentages à 0 par défaut : règle désactivée", () => {
  assert.equal(SETTING_SPECS.title_source_pct.default, 0);
  assert.equal(SETTING_SPECS.meta_source_pct.default, 0);
});

test("title_min doit rester sous title_max", () => {
  assert.throws(() => checkCoherence({ ...defauts(), title_min: 90, title_max: 90 }), /title_min/);
});

test("meta_title_min doit rester sous meta_title_max", () => {
  assert.throws(() => checkCoherence({ ...defauts(), meta_title_min: 60, meta_title_max: 60 }), /meta_title_min/);
});

test("llm_regen_engines : vide accepté (aucune relance)", () => {
  assert.equal(SETTING_SPECS.llm_regen_engines.default, "");
  assert.equal(coerceSetting(SETTING_SPECS.llm_regen_engines, ""), "");
});
