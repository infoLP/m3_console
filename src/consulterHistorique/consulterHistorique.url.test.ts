import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filtresHistoriqueDepuis, paramsHistorique, uuidValide } from "./consulterHistorique.regles";

describe("historique : filtres dans l'URL", () => {
  it("défauts omis", () => {
    assert.equal(paramsHistorique({ category: "", q: "" }), "");
    assert.deepEqual(filtresHistoriqueDepuis({}), { category: "", q: "" });
  });
  it("aller-retour", () => {
    for (const f of [{ category: "publie", q: "" }, { category: "", q: "mairie" }, { category: "archive", q: "fête de l'été" }, { category: "purge", q: "x" }]) {
      const sp = Object.fromEntries(new URLSearchParams(paramsHistorique(f)));
      assert.deepEqual(filtresHistoriqueDepuis(sp), f);
    }
  });
  it("catégorie inconnue ignorée, tableau : premier", () => {
    assert.deepEqual(filtresHistoriqueDepuis({ category: "inconnue", q: "a" }), { category: "", q: "a" });
    assert.deepEqual(filtresHistoriqueDepuis({ category: ["valide", "publie"] }), { category: "valide", q: "" });
  });
  it("encodage de q : accents et espaces", () => {
    const s = paramsHistorique({ category: "", q: "été à Nîmes" });
    assert.ok(!s.includes(" ") && !s.includes("é"));
    assert.equal(filtresHistoriqueDepuis(Object.fromEntries(new URLSearchParams(s))).q, "été à Nîmes");
  });
});

describe("T14 : recherche par UUID", () => {
  const u = "3f2b8c1e-9a4d-4e6b-8c2a-1d5e7f9a0b3c";
  it("UUID complet seulement, casse et espaces tolérés", () => {
    assert.equal(uuidValide(` ${u.toUpperCase()} `), u);
    assert.equal(uuidValide("3f2b8c1e-9a4d"), null);
    assert.equal(uuidValide(""), null);
  });
  it("aller-retour dans l'URL, UUID invalide ignoré", () => {
    const sp = Object.fromEntries(new URLSearchParams(paramsHistorique({ category: "", q: "", uuid: u })));
    assert.deepEqual(sp, { uuid: u });
    assert.deepEqual(filtresHistoriqueDepuis(sp), { category: "", q: "", uuid: u });
    assert.deepEqual(filtresHistoriqueDepuis({ uuid: "pas-un-uuid" }), { category: "", q: "" });
    assert.equal(paramsHistorique({ category: "", q: "", uuid: "abc" }), "");
  });
});
