/* M3-109, axe B2 — fonctions pures des Paramètres : « réglé ici » contre valeur
   du moteur, forme du détail journalisé, auteur des versions, contrôle de
   llm_regen_engines contre un registre simulé. Sans base. */

import test from "node:test";
import assert from "node:assert/strict";

import { settingsFromRows, SETTING_SPECS } from "../src/lib/yamlStore.js";
import { regenEnginesErrors, settingsChanges, settingsAuthor } from "../src/api/meta.js";

test("réglé ici : les clés présentes en base, et seulement des réglages déclarés", () => {
  const { settings, stored } = settingsFromRows([
    { key: "window_hours", value: "48" },
    { key: "site_icon", value: "data:image/png;base64,AAAA" },
    { key: "llm_provider", value: "openrouter" },
  ]);
  assert.deepEqual(stored, ["window_hours"]);
  assert.equal(settings.window_hours, 48, "recoercé en nombre");
  assert.equal(settings.signs_max, SETTING_SPECS.signs_max.default, "absent : valeur du moteur");
  assert.equal("site_icon" in settings, false);
});

test("réglé ici : une valeur illisible reste « réglée ici » (la ligne existe) mais vaut le défaut", () => {
  const { settings, stored } = settingsFromRows([{ key: "window_hours", value: "pas un nombre" }]);
  assert.deepEqual(stored, ["window_hours"]);
  assert.equal(settings.window_hours, SETTING_SPECS.window_hours.default);
});

test("réglé ici : table vide → rien de réglé, tout au défaut", () => {
  const { settings, stored } = settingsFromRows([]);
  assert.deepEqual(stored, []);
  assert.equal(Object.keys(settings).length, Object.keys(SETTING_SPECS).length);
});

test("journal : { clé: { avant, apres } }, valeurs typées, seulement ce qui change", () => {
  const d = settingsChanges({ window_hours: 72, wp_target: "a", llm_regen_engines: "" }, { window_hours: 48, wp_target: "a", llm_regen_engines: "openai:gpt" });
  assert.deepEqual(d, { window_hours: { avant: 72, apres: 48 }, llm_regen_engines: { avant: "", apres: "openai:gpt" } });
  assert.deepEqual(settingsChanges({ a: 1 }, { a: "1" }), {}, "même valeur sous une autre forme : pas un changement");
});

test("config_history.author : la personne et le rôle exercé ; sans compte, le rôle", () => {
  assert.equal(settingsAuthor({ id: "u1", login: "a.martin", name: "A. Martin" }, "administrateur"), "a.martin (administrateur)");
  assert.equal(settingsAuthor({ id: "u1", name: "A. Martin" }, "administrateur"), "A. Martin (administrateur)");
  assert.equal(settingsAuthor(null, "administrateur"), "administrateur");
});

const REGISTRE = [
  { id: "openai", defaultModel: "gpt-4.1", enabled: true },
  { id: "anthropic", defaultModel: "claude-sonnet", enabled: false },
  { id: "openrouter", defaultModel: "openrouter/auto", enabled: true },
];

test("llm_regen_engines : vide accepté", () => {
  assert.deepEqual(regenEnginesErrors("", REGISTRE), []);
  assert.deepEqual(regenEnginesErrors("  ,  ;\n", REGISTRE), []);
});

test("llm_regen_engines : moteurs du registre acceptés, désactivé compris, modèle explicite ou non", () => {
  assert.deepEqual(regenEnginesErrors("openai, anthropic:claude-opus; openrouter:meta/llama:free", REGISTRE), []);
});

test("llm_regen_engines : moteur inconnu refusé, nommé", () => {
  assert.deepEqual(regenEnginesErrors("xyz", REGISTRE), ["llm_regen_engines : « xyz » n'est pas un moteur du registre"]);
  assert.deepEqual(regenEnginesErrors("xyz:modele", []), ["llm_regen_engines : « xyz » n'est pas un moteur du registre"], "registre vide");
});

test("llm_regen_engines : mock refusé", () => {
  assert.match(regenEnginesErrors("mock", REGISTRE)[0], /« mock » est le moteur factice \(mock\), exclu des relances/);
});

test("llm_regen_engines : routeur refusé, par le modèle donné ou par le modèle par défaut du moteur", () => {
  assert.deepEqual(regenEnginesErrors("openai:~openai/gpt-latest", REGISTRE),
    ["llm_regen_engines : « openai:~openai/gpt-latest » est un routeur : modèle variable, exclu des relances"]);
  assert.deepEqual(regenEnginesErrors("openrouter", REGISTRE),
    ["llm_regen_engines : « openrouter » est un routeur (modèle par défaut openrouter/auto) : modèle variable, exclu des relances"]);
});

test("llm_regen_engines : plusieurs entrées, chaque fautive nommée, dans l'ordre", () => {
  const e = regenEnginesErrors("openai, xyz; mock\nopenrouter:openrouter/auto", REGISTRE);
  assert.equal(e.length, 3);
  assert.match(e[0], /« xyz » n'est pas un moteur du registre/);
  assert.match(e[1], /« mock »/);
  assert.match(e[2], /« openrouter:openrouter\/auto » est un routeur/);
});
