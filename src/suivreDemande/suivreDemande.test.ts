import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etatDemande, estFinie, delaiSondage, LIBELLE_ETAT } from "./suivreDemande.regles";

describe("suivre une demande", () => {
  it("état : attente, en cours, terminée, échec", () => {
    assert.equal(etatDemande({ startedAt: null, finishedAt: null, error: null }), "attente");
    assert.equal(etatDemande({ startedAt: "t", finishedAt: null, error: null }), "cours");
    assert.equal(etatDemande({ startedAt: "t", finishedAt: "t", error: null }), "finie");
    assert.equal(etatDemande({ startedAt: "t", finishedAt: "t", error: "non implémentée" }), "echec");
    assert.equal(LIBELLE_ETAT.attente, "En attente du moteur");
  });
  it("finie seulement avec une date de fin", () => {
    assert.equal(estFinie(null), false);
    assert.equal(estFinie({ finishedAt: null }), false);
    assert.equal(estFinie({ finishedAt: "2026-10-28T10:00:00Z" }), true);
  });
  it("sondage : 1 s au début, puis 2 s, puis 5 s", () => {
    assert.equal(delaiSondage(0), 1000);
    assert.equal(delaiSondage(10), 2000);
    assert.equal(delaiSondage(40), 5000);
  });
});
