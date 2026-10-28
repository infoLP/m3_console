/* M3-113 — forme de `scoring` dans /api/me : les réglages dont le panneau
   Preuves a besoin pour l'attendu d'un article ancien. */

import test from "node:test";
import assert from "node:assert/strict";

import { scoringDe } from "../src/api/meta.js";
import { DEFAULT_SETTINGS, PROMPT_DEFAULTS } from "../shared/model.js";

test("scoring : grille, prompt, fraîcheur et doublon ; rien d'autre", () => {
  const settings = { ...DEFAULT_SETTINGS, ...PROMPT_DEFAULTS, window_hours: 48, dedup_threshold: 0.7, secret_api_key: "x" };
  const s = scoringDe(settings);
  for (const k of ["slug_max_words", "breve_signs_min", "signs_max", "ranking_threshold", "title_max", "h2_title_max", "outline_h2_min", "h2_above_signs"]) {
    assert.ok(k in s, k);
  }
  assert.equal(s.window_hours, 48);
  assert.equal(s.dedup_threshold, 0.7);
  assert.ok(!("signs_min" in s), "signs_min supprimé (M3-113)");
  assert.ok(!("meta_title_min" in s) || "meta_title_min" in PROMPT_DEFAULTS, "meta_title_min hors de la grille");
  assert.ok(!("secret_api_key" in s), "seules les clés connues partent");
});
