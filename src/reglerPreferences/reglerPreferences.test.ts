import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etatTouche, libelleTouche, raccourcis } from "./reglerPreferences.regles";

describe("raccourcis", () => {
  it("libellé : touche en capitale, flèche alternative", () => {
    const { actions } = raccourcis({}, {});
    const next = actions.find((a) => a.id === "next")!;
    assert.equal(libelleTouche(next), "J · ↓");
    assert.equal(libelleTouche(actions.find((a) => a.id === "pub")!), "P");
  });
  it("état : borné par l'administrateur, coupé par l'utilisateur, armé", () => {
    const bornes = raccourcis({ keys_decisions: "non" }, {}).actions;
    assert.match(etatTouche(bornes.find((a) => a.id === "pub")!), /décisions au clavier/);
    const coupe = raccourcis({}, { keysOff: ["next"] }).actions;
    assert.match(etatTouche(coupe.find((a) => a.id === "next")!), /désactivé/);
    assert.equal(etatTouche(raccourcis({}, {}).actions.find((a) => a.id === "arch")!), " — deux frappes");
  });
});
