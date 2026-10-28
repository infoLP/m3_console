import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { geometrieBarres, rubriques } from "./consulterSuivi.regles";

describe("suivi : graphe", () => {
  it("échelle sur le maximum de toutes les séries, trois barres par jour", () => {
    const g = geometrieBarres([{ date: "2026-10-13", created: 4, accepted: 2, archived: 1, published: 0 }, { date: "2026-10-14", created: 1, accepted: 8, archived: 0, published: 0 }])!;
    assert.equal(g.max, 8);
    assert.equal(g.barres.length, 6);
    const haute = g.barres.find((b) => b.title.includes("accepted : 8"))!;
    assert.equal(Math.round(haute.h), 200 - 28 * 2, "la plus haute barre occupe toute la hauteur utile");
    assert.deepEqual(g.grille.map((l) => l.valeur), [0, 4, 8]);
    assert.deepEqual(g.etiquettes.map((e) => e.texte), ["10-13", "10-14"]);
  });
  it("sans série : rien", () => { assert.equal(geometrieBarres([]), null); });
  it("rubriques triées, largeur relative au maximum", () => {
    const r = rubriques({ byCategory: { Sport: 1, Économie: 4 } } as never);
    assert.deepEqual(r.map((x) => x.k), ["Économie", "Sport"]);
    assert.equal(r[1].pct, 25);
  });
});
