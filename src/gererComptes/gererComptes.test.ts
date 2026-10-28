import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comptesModifies, motDePasseAcceptable, nouveauCompte } from "./gererComptes.regles";

describe("comptes", () => {
  it("un mot de passe fait 8 caractères au moins", () => {
    assert.equal(motDePasseAcceptable("1234567"), "8 caractères minimum.");
    assert.equal(motDePasseAcceptable("12345678"), null);
  });
  it("comptesModifies ignore canLogin et voit un champ changé ou une ligne en plus", () => {
    const ref = [{ id: "a", name: "A", login: "a@x", role: "relecteur", canLogin: false }];
    assert.equal(comptesModifies([{ ...ref[0], canLogin: true }], ref), false);
    assert.equal(comptesModifies([{ ...ref[0], name: "B" }], ref), true);
    assert.equal(comptesModifies([...ref, nouveauCompte()], ref), true);
  });
});
