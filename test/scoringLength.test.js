/* M3-86 : la grille de notation juge la longueur sur la fenêtre calculée à la
   génération (checks.length), la même que celle citée au prompt — et retombe sur
   les bornes globales des Paramètres pour un article qui n'en a pas.
   M3-113 (décision 1) : ces bornes sont celles de la génération, breve_signs_min
   à signs_max ; signs_min (1 500), lu par la seule grille, est supprimé. */

import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../shared/scoring.js";

const corps = (n) => [{ type: "p", text: "x".repeat(n) }];
const reglages = { breve_signs_min: 600, signs_max: 7000, ranking_threshold: 60 };

test("sans fenêtre, les bornes globales des Paramètres : breve_signs_min à signs_max", () => {
  const A = analyze({ body: corps(500) }, reglages);
  assert.equal(A.lengthOK, false);
  assert.deepEqual([A.lengthMin, A.lengthMax, A.lengthCible], [600, 7000, null]);
  assert.equal(analyze({ body: corps(2000) }, reglages).lengthOK, true);
});

test("sans fenêtre, une brève de 600 à 1 500 signes passe, comme à la génération", () => {
  assert.equal(analyze({ body: corps(1000) }, reglages).lengthOK, true, "rejetée avant M3-113 (signs_min 1 500)");
  assert.equal(analyze({ body: corps(1000) }, { ...reglages, signs_min: 1500 }).lengthOK, true, "signs_min n'est plus lu");
  assert.equal(analyze({ body: corps(1000) }).lengthMin, 600, "défaut : breve_signs_min de DEFAULT_SETTINGS");
});

test("avec checks.length, la fenêtre de la génération remplace les bornes globales", () => {
  const checks = { length: { target: 900, min: 720, max: 1080, signs: 900, ok: true } };
  const court = analyze({ body: corps(1000), checks }, reglages);
  assert.equal(court.lengthOK, true, "1 000 signes : dans la fenêtre");
  assert.deepEqual([court.lengthMin, court.lengthMax, court.lengthCible], [720, 1080, 900]);
  assert.equal(analyze({ body: corps(2000), checks }, reglages).lengthOK, false, "au-delà de la fenêtre");
});

test("une fenêtre incohérente est ignorée", () => {
  const A = analyze({ body: corps(2000), checks: { length: { min: 0, max: 0 } } }, reglages);
  assert.deepEqual([A.lengthOK, A.lengthMin, A.lengthMax], [true, 600, 7000]);
});
