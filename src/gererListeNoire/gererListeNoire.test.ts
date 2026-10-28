import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adresseValide, libelleMotif, refusBannissement } from "./gererListeNoire.regles";

describe("adresseValide", () => {
  it("une adresse seule, v4 ou v6 ; ni plage, ni nom", () => {
    assert.equal(adresseValide("203.0.113.7"), true);
    assert.equal(adresseValide(" 2001:db8::1 "), true);
    assert.equal(adresseValide("203.0.113.0/24"), false);
    assert.equal(adresseValide("256.1.1.1"), false);
    assert.equal(adresseValide("exemple.fr"), false);
    assert.equal(adresseValide("1::2::3"), false);
  });
});

describe("refusBannissement", () => {
  const liste = { selfIp: "198.51.100.4", bans: [{ ip: "203.0.113.7", bannedAt: "", reason: "auto", failures: 15, logins: [], bannedBy: null, note: null }] };
  it("refuse sa propre adresse, un doublon, une saisie vide ou invalide", () => {
    assert.match(refusBannissement("198.51.100.4", liste) ?? "", /propre adresse/);
    assert.match(refusBannissement("203.0.113.7", liste) ?? "", /déjà/);
    assert.match(refusBannissement("  ", liste) ?? "", /Saisissez/);
    assert.match(refusBannissement("10.0.0.0/8", liste) ?? "", /invalide/);
    assert.equal(refusBannissement("203.0.113.8", liste), null);
  });
});

describe("libelleMotif", () => {
  it("dit automatique avec le nombre de refus, ou qui a banni", () => {
    assert.equal(libelleMotif({ ip: "x", bannedAt: "", reason: "auto", failures: 15, logins: [], bannedBy: null, note: null }), "automatique — 15 refus");
    assert.equal(libelleMotif({ ip: "x", bannedAt: "", reason: "manuel", failures: 0, logins: [], bannedBy: "A. Sanchez", note: null }), "à la main — A. Sanchez");
  });
});
