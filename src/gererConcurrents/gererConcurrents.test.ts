import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DROITS_COQUE_ADMIN, HREF_CONCURRENTS, SAISIE_VIDE, adresseValide, lienConcurrentsConsole, ongletsVisibles, refusSaisie,
  sousOngletsSources, type Onglet,
  actionsCandidat, dernierScan, hrefCreerSource, lienParametres, marquesCandidat, sourceDepuisCandidat, sourcePourDomaine, texteBandeau,
  type Concurrent, type EtatScan, type StatutCandidat,
} from "./gererConcurrents.regles";
import { can } from "@shared/model.js";

const ONGLETS: Onglet[] = [
  ["/admin", "Sources", "Sliders"],
  ["/admin/utilisateurs", "Utilisateurs", "Users"],
  ["/admin/parametres", "Paramètres", "Settings"],
];

describe("droits (M3-120)", () => {
  it("manage_competitors : administrateur et superutilisateur, pas le relecteur", () => {
    assert.equal(can("administrateur", "manage_competitors"), true);
    assert.equal(can("super_utilisateur", "manage_competitors"), true);
    assert.equal(can("relecteur", "manage_competitors"), false);
  });
  it("le superutilisateur n'a toujours pas le droit backoffice", () => {
    assert.equal(can("super_utilisateur", "backoffice"), false);
  });
  it("la coque /admin s'ouvre avec backoffice ou manage_competitors, pas pour le relecteur", () => {
    const ouvre = (r: string) => DROITS_COQUE_ADMIN.some((d) => can(r, d));
    assert.equal(ouvre("administrateur"), true);
    assert.equal(ouvre("super_utilisateur"), true);
    assert.equal(ouvre("relecteur"), false);
  });
});

describe("colonne du back-office", () => {
  it("administrateur : tous les onglets, inchangés", () => {
    assert.deepEqual(ongletsVisibles(ONGLETS, "administrateur"), ONGLETS);
  });
  it("superutilisateur : le seul onglet Sources, qui mène à Concurrents", () => {
    assert.deepEqual(ongletsVisibles(ONGLETS, "super_utilisateur"), [[HREF_CONCURRENTS, "Sources", "Sliders"]]);
  });
  it("relecteur : rien", () => {
    assert.deepEqual(ongletsVisibles(ONGLETS, "relecteur"), []);
  });
});

describe("sous-navigation Sources | Concurrents", () => {
  it("administrateur : les deux", () => {
    assert.deepEqual(sousOngletsSources("administrateur").map(([h]) => h), ["/admin", HREF_CONCURRENTS]);
  });
  it("superutilisateur : Concurrents seul", () => {
    assert.deepEqual(sousOngletsSources("super_utilisateur").map(([h]) => h), [HREF_CONCURRENTS]);
  });
});

describe("lien de la console", () => {
  it("seulement avec manage_competitors et sans backoffice", () => {
    assert.equal(lienConcurrentsConsole("super_utilisateur"), true);
    assert.equal(lienConcurrentsConsole("administrateur"), false);   // il a déjà « Back-office »
    assert.equal(lienConcurrentsConsole("relecteur"), false);
  });
});

describe("saisie", () => {
  it("adresse http(s) sans identifiant, paramètre ni ancre", () => {
    assert.equal(adresseValide("https://www.sudouest.fr"), true);
    assert.equal(adresseValide("http://exemple.fr/actu/"), true);
    for (const u of ["", "sudouest.fr", "ftp://x.fr", "https://a:b@x.fr", "https://x.fr/?p=1", "https://x.fr/#a"]) {
      assert.equal(adresseValide(u), false, u);
    }
  });
  it("libellé de 2 à 80 caractères", () => {
    assert.match(refusSaisie({ ...SAISIE_VIDE, label: "A", url: "https://x.fr" }) || "", /trop court/);
    assert.match(refusSaisie({ label: "A".repeat(81), url: "https://x.fr" }) || "", /trop long/);
    assert.equal(refusSaisie({ label: "Sud Ouest", url: "https://x.fr" }), null);
  });
});

describe("scan et domaines candidats (M3-122)", () => {
  const C = (status: StatutCandidat) => ({ status });

  it("actions : l'admin crée la source, le SU propose, les deux écartent ; rien sur ajouté/écarté ni pour le relecteur", () => {
    assert.deepEqual(actionsCandidat("administrateur", C("nouveau")), { creer: true, proposer: false, ecarter: true });
    assert.deepEqual(actionsCandidat("super_utilisateur", C("nouveau")), { creer: false, proposer: true, ecarter: true });
    assert.deepEqual(actionsCandidat("super_utilisateur", C("propose")), { creer: false, proposer: false, ecarter: true });
    assert.deepEqual(actionsCandidat("administrateur", C("propose")), { creer: true, proposer: false, ecarter: true });
    for (const s of ["ajoute", "ecarte"] as const) {
      assert.deepEqual(actionsCandidat("administrateur", C(s)), { creer: false, proposer: false, ecarter: false });
    }
    assert.deepEqual(actionsCandidat("relecteur", C("nouveau")), { creer: false, proposer: false, ecarter: false });
    assert.equal(hrefCreerSource({ id: 7 }), "/admin?candidat=7");
  });

  it("bandeau : indisponible, en cours, dernier scan, prochain créneau ou désactivé ; lien Paramètres pour l'admin seul", () => {
    assert.match(texteBandeau(null).dernier, /pas encore disponible/);
    const e: EtatScan = { running: true, startedAt: "2026-10-27T09:00:00Z", enabled: false, next: null,
      last: { at: "2026-10-27T01:30:00Z", trigger: "planifie", by: null, competitors: 3, errors: 1, candidates: 5 } };
    const t = texteBandeau(e);
    assert.match(t.etat, /Scan en cours depuis/);
    assert.match(t.dernier, /planifié.*3 concurrent\(s\) lu\(s\), 1 en erreur, 5 nouveau\(x\) domaine\(s\)/);
    assert.equal(t.prochain, "Scan quotidien désactivé.");
    assert.match(texteBandeau({ ...e, running: false, enabled: true, next: "2026-10-28T01:30:00Z", last: { ...e.last!, trigger: "manuel", by: "Super Test" } }).prochain, /Prochain scan planifié/);
    assert.match(texteBandeau({ ...e, last: { ...e.last!, trigger: "manuel", by: "Super Test" } }).dernier, /manuel, par Super Test/);
    assert.equal(texteBandeau({ ...e, running: false }).etat, "");
    assert.equal(lienParametres("administrateur"), true);
    assert.equal(lienParametres("super_utilisateur"), false);
  });

  it("colonne Dernier scan : jamais, voie, aucun article, erreur", () => {
    const c = (lastScan: Concurrent["lastScan"]): Concurrent => ({ id: 1, label: "X", url: "https://x.fr", active: true, createdBy: null, createdAt: "", updatedAt: "", lastScan });
    assert.deepEqual(dernierScan(c(null)), { texte: "jamais", detail: null, erreur: false });
    assert.equal(dernierScan(c({ at: "2026-10-27T09:00:00Z", status: "ok", via: "flux", error: null })).detail, "par flux RSS");
    assert.equal(dernierScan(c({ at: "2026-10-27T09:00:00Z", status: "vide", via: "page", error: null })).detail, "aucun article, par page liste");
    const err = dernierScan(c({ at: "2026-10-27T09:00:00Z", status: "erreur", via: null, error: "HTTP 503" }));
    assert.equal(err.erreur, true);
    assert.equal(err.detail, "HTTP 503");
  });

  it("Créer la source : brouillon inactif pré-rempli, marqué du candidat, marque retirée à l'enregistrement", () => {
    const s = sourceDepuisCandidat({ id: 7, domain: "gironde.fr" });
    assert.equal(s.name, "gironde.fr");
    assert.equal(s.active, false);
    assert.equal(s.fromCandidate, 7);
    assert.equal(s.fromTicket, undefined);
    assert.ok([s.rssUrl, s.listUrl, s.pressUrl, s.siteUrl].includes("https://gironde.fr"));
    const autre = { id: "a", name: "A", type: "rss", rssUrl: "https://www.gironde.fr/rss" };
    const { ids, propres } = marquesCandidat([s, autre]);
    assert.deepEqual(ids, [7]);
    assert.equal(propres[0].fromCandidate, undefined);
    assert.equal(propres[1], autre);
    assert.equal(s.fromCandidate, 7, "la source affichée garde sa marque");
  });

  it("source déjà au référentiel pour ce domaine (www. et sous-domaines compris)", () => {
    const sources = [{ id: "a", name: "A", type: "rss", rssUrl: "https://www.gironde.fr/rss" }, { id: "b", name: "B", type: "site", siteUrl: "https://actu.bordeaux.fr" }];
    assert.equal(sourcePourDomaine(sources, "gironde.fr")?.id, "a");
    assert.equal(sourcePourDomaine(sources, "bordeaux.fr")?.id, "b");
    assert.equal(sourcePourDomaine(sources, "landes.fr"), null);
    assert.equal(sourcePourDomaine(sources, "ironde.fr"), null);
  });
});
