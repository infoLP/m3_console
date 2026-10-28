import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTiroir, SEUILS_TIROIR } from "./Tiroir.logique";

test("sous 1000 px, le tiroir prend tout l'écran", () => {
  assert.equal(formatTiroir(375), "plein");
  assert.equal(formatTiroir(999), "plein");
});

test("de 1000 à 1400 px inclus, il prend la moitié", () => {
  assert.equal(formatTiroir(1000), "demi");
  assert.equal(formatTiroir(1280), "demi");
  assert.equal(formatTiroir(1400), "demi");
});

test("au-delà de 1400 px, largeur confortable", () => {
  assert.equal(formatTiroir(1401), "confortable");
  assert.equal(formatTiroir(1920), "confortable");
});

test("les seuils sont ceux de la décision 4", () => {
  assert.deepEqual(SEUILS_TIROIR, { plein: 1000, demi: 1400 });
});
