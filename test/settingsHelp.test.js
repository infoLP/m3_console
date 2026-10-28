/* Chaque réglage de l'onglet Paramètres porte un libellé et une explication
   (shared/settingsHelp.js). Ce test échoue dès qu'un réglage est ajouté à
   SETTING_SPECS sans sa ligne : il s'afficherait sinon sous « Autres », avec sa
   seule clé — exactement ce que l'explicitation a corrigé. */

import test from "node:test";
import assert from "node:assert/strict";

import { SETTING_SPECS } from "../src/lib/yamlStore.js";
import { SETTING_HELP, SETTING_SECTIONS } from "../shared/settingsHelp.js";

test("chaque réglage a un libellé et une explication", () => {
  const missing = Object.keys(SETTING_SPECS).filter((k) => !SETTING_HELP[k]?.label || !SETTING_HELP[k]?.help);
  assert.deepEqual(missing, [], `réglages sans explication : ${missing.join(", ")}`);
});

test("chaque explication est rangée dans une section qui existe", () => {
  const ids = new Set(SETTING_SECTIONS.map((s) => s.id));
  const orphans = Object.entries(SETTING_HELP).filter(([, h]) => !ids.has(h.section)).map(([k]) => k);
  assert.deepEqual(orphans, []);
});
