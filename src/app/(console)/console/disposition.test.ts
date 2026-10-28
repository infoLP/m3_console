import { test } from "node:test";
import assert from "node:assert/strict";
import { ancreDetail, ancrePreuve, ancresCible, disposition, pastillesConformite, SECTIONS_DETAIL } from "./disposition.logique";

test("demi-écran (700 à 999 px) : file et détail en tiroir", () => {
  assert.deepEqual(disposition(700), { file: "tiroir", detail: "tiroir" });
  assert.deepEqual(disposition(950), { file: "tiroir", detail: "tiroir" });
  assert.deepEqual(disposition(999), { file: "tiroir", detail: "tiroir" });
});

test("de 1000 à 1400 px : file en colonne étroite, détail en tiroir", () => {
  assert.deepEqual(disposition(1000), { file: "colonne", detail: "tiroir" });
  assert.deepEqual(disposition(1280), { file: "colonne", detail: "tiroir" });
  assert.deepEqual(disposition(1400), { file: "colonne", detail: "tiroir" });
});

test("au-delà de 1400 px : trois colonnes", () => {
  assert.deepEqual(disposition(1401), { file: "colonne", detail: "colonne" });
  assert.deepEqual(disposition(1920), { file: "colonne", detail: "colonne" });
});

test("une cible de preuve essaie d'abord l'ancre du critère, puis la section", () => {
  assert.deepEqual(ancresCible({ section: "preuves", critere: "source" }), [ancrePreuve("source"), ancreDetail("preuves")]);
  assert.deepEqual(ancresCible({ section: "seo" }), [ancreDetail("seo")]);
  assert.deepEqual(ancresCible({ section: "seo", critere: "source" }), [ancreDetail("seo")]);
  assert.ok(SECTIONS_DETAIL.includes("preuves") && SECTIONS_DETAIL.includes("relances"));
});

test("pastilles : les cinq critères, dans l'ordre de CRITERIA", () => {
  const p = pastillesConformite({ lengthOK: true, rankOK: false, sourceOK: true, illoOK: false, seoOK: true });
  assert.deepEqual(p.map((x) => x.cle), ["longueur", "ranking", "source", "illustration", "seo"]);
  assert.deepEqual(p.map((x) => x.ok), [true, false, true, false, true]);
  assert.equal(p[1].libelle, "Alignement éditorial");
});
