import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { libelleStatut } from "./statutDemande";

describe("statut d'une demande de source", () => {
  it("traduit les statuts connus", () => {
    assert.equal(libelleStatut("ouvert"), "à traiter");
    assert.equal(libelleStatut("traite"), "traitée");
  });
  it("affiche tel quel un statut inconnu", () => {
    assert.equal(libelleStatut("rejete"), "rejete");
    assert.equal(libelleStatut(""), "");
  });
});
