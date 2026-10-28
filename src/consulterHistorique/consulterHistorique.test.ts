import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auteur, chaineDecisions, datesFiche, harvestedOf, libelleStatut, puceStatut } from "./consulterHistorique.regles";

describe("historique", () => {
  it("date de récupération : enregistrée, sinon lue dans l'identifiant, sinon rien", () => {
    assert.deepEqual(harvestedOf({ id: "art-2026-10-13-x", status: "publie", harvestedAt: "2026-10-13T08:00:00Z" }), { iso: "2026-10-13T08:00:00Z", approx: false });
    assert.deepEqual(harvestedOf({ id: "art-2026-10-13-x", status: "publie" }), { iso: "2026-10-13T12:00:00Z", approx: true });
    assert.equal(harvestedOf({ id: "autre", status: "publie" }), null);
  });
  it("puce : purgé dit ce qu'il était, valide = en attente", () => {
    assert.equal(puceStatut("purge", "valide").label, "Purgé · était en attente");
    assert.equal(puceStatut("purge", "publie").label, "Purgé · était publié");
    assert.equal(puceStatut("valide").label, "En attente");
  });
  it("auteur réservé, enregistré, ou absent avec la raison", () => {
    assert.equal(auteur({ id: "x", status: "publie", decidedBy: "A" }, false).texte, null);
    assert.equal(auteur({ id: "x", status: "publie", decidedBy: "A", decidedByRole: "relecteur" }, true).title, "Rôle exercé : Utilisateur-Relecteur");
    assert.match(auteur({ id: "x", status: "publie", legacy: true }, true).title ?? "", /traçabilité/);
  });
  it("M3-102 : archivage automatique — « Par » nomme le système, sans chercher un rôle", () => {
    const r = { id: "x", status: "archive", decidedBy: "Archivage automatique", decidedByRole: "systeme" };
    const a = auteur(r, true);
    assert.equal(a.texte, "Archivage automatique");
    assert.match(a.title ?? "", /automatique/);
    assert.doesNotMatch(a.title ?? "", /Rôle exercé/);
    assert.equal(auteur(r, false).texte, null, "réservé comme les autres décideurs");
  });
});

describe("T14 : article effacé", () => {
  const fiche = {
    sourceUrl: "https://ex.fr/a", sourcePublishedAt: "2026-10-01T08:00:00Z", publishedAt: "2026-10-03T08:00:00Z",
    purgedAt: "2026-10-10T08:00:00Z", purgedBy: "Admin", erasedAt: "2026-10-20T08:00:00Z", erasedBy: "auto", generatedBy: "mistral",
    decisions: [{ status: "publie", at: "2026-10-03T08:00:00Z", byName: "Ana", byRole: "relecteur" }, { status: "efface", at: "2026-10-20T08:00:00Z", auto: true }],
  };
  const r = { id: "art-2026-10-01-x", status: "efface", createdAt: "2026-10-02T08:00:00Z", decidedAt: "2026-10-20T08:00:00Z", fiche };
  it("puce et libellé « Effacé »", () => {
    assert.equal(puceStatut("efface").label, "Effacé");
    assert.equal(libelleStatut("efface"), "Effacé");
    assert.equal(libelleStatut("purge"), "Purgé");
  });
  it("dates dans l'ordre, avec leurs auteurs", () => {
    const d = datesFiche(r);
    assert.deepEqual(d.map((x) => x.libelle), ["Récupéré le (approché)", "Généré le", "Parution de la source", "Publié le", "Purgé le", "Effacé le"]);
    assert.equal(d[1].par, "moteur mistral");
    assert.equal(d[4].par, "par Admin");
    assert.equal(d[5].par, "automatique");
  });
  it("noms masqués : aucun « null » affiché", () => {
    const masque = { ...r, fiche: { ...fiche, purgedBy: null, erasedBy: null, decisions: fiche.decisions.map((x) => ({ ...x, byName: null, byRole: null })) } };
    for (const d of datesFiche(masque)) assert.doesNotMatch(String(d.par ?? ""), /null/);
    const c = chaineDecisions(masque.fiche);
    assert.equal(c[0].nom, null);
    assert.equal(c[0].role, null);
    assert.equal(c[0].statut, "Publié");
  });
  it("chaîne des décisions : nom et rôle", () => {
    assert.deepEqual(chaineDecisions(fiche)[0], { statut: "Publié", iso: "2026-10-03T08:00:00Z", nom: "Ana", role: "Utilisateur-Relecteur" });
    assert.equal(chaineDecisions(undefined).length, 0);
  });
});
