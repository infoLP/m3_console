import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHAMPS_VIDES, construireDemande } from "./demanderSource.regles";

describe("demande de source", () => {
  it("nom et adresse requis, adresse en http(s)", () => {
    assert.deepEqual(construireDemande(CHAMPS_VIDES), { erreur: "Le nom et l'adresse de la source sont requis." });
    assert.match((construireDemande({ ...CHAMPS_VIDES, name: "x", url: "mairie.fr" }) as { erreur: string }).erreur, /http/);
  });
  it("zone vide acceptée, zone inconnue refusée, zone connue décomposée", () => {
    const ok = construireDemande({ ...CHAMPS_VIDES, name: "x", url: "https://m.fr", zone: "" }) as { demande: { dept: string } };
    assert.equal(ok.demande.dept, "");
    assert.match((construireDemande({ ...CHAMPS_VIDES, name: "x", url: "https://m.fr", zone: "nulle part" }) as { erreur: string }).erreur, /Zone inconnue/);
    const d = construireDemande({ ...CHAMPS_VIDES, name: " x ", url: "https://m.fr", zone: "17 · Charente-Maritime" }) as { demande: { dept: string; name: string } };
    assert.equal(d.demande.dept, "17");
    assert.equal(d.demande.name, "x");
  });
});
