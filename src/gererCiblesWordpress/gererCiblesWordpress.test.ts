import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SAISIE_VIDE, adresseValide, avertissements, libelleArrivee, libelleGreffon, refusSaisie, saisieDe,
  type CiblePublique, type EtatPublication, type Saisie,
} from "./gererCiblesWordpress.regles";
import { consequenceDesactivation, consequenceSuppression } from "../app/(console)/admin/publication/TableauCibles.consequences";

const SAISIE: Saisie = { ...SAISIE_VIDE, name: "Vie économique", url: "https://wp.test", wpUser: "console", password: "abcd efgh ijkl" };

const cible = (extra: Partial<CiblePublique> = {}): CiblePublique => ({
  id: 1, name: "Vie économique", url: "https://wp.test", wpUser: "console", secretHint: "abcd…ijkl", seoPlugin: "rankmath",
  createCategories: false, publishStatus: "draft", isDefault: true, active: true, createdBy: null, createdAt: "", updatedAt: "", ...extra,
});

const etat = (extra: Partial<EtatPublication> = {}): EtatPublication => ({
  targets: [cible()], moteurVivant: true, mode: "wordpress", envConfigured: false, secretsAvailable: true, simulatedTarget: null, ...extra,
});

describe("adresseValide", () => {
  it("http(s) sans identifiant, paramètre ni ancre", () => {
    assert.equal(adresseValide("https://site.test"), true);
    assert.equal(adresseValide(" http://site.test/blog "), true);
    assert.equal(adresseValide("site.test"), false);
    assert.equal(adresseValide("https://u:p@site.test"), false);
    assert.equal(adresseValide("https://site.test/?x=1"), false);
    assert.equal(adresseValide("ftp://site.test"), false);
  });
});

describe("refusSaisie", () => {
  it("accepte une saisie complète", () => {
    assert.equal(refusSaisie(SAISIE, { creation: true }), null);
  });
  it("dit pourquoi, champ par champ", () => {
    assert.match(refusSaisie({ ...SAISIE, name: "x" }, { creation: true }) ?? "", /Nom trop court/);
    assert.match(refusSaisie({ ...SAISIE, url: "pas une adresse" }, { creation: true }) ?? "", /Adresse invalide/);
    assert.match(refusSaisie({ ...SAISIE, wpUser: "" }, { creation: true }) ?? "", /Compte WordPress/);
    assert.match(refusSaisie({ ...SAISIE, password: "court" }, { creation: true }) ?? "", /trop court/);
  });
  it("le mot de passe est obligatoire à la création, facultatif à la modification", () => {
    assert.match(refusSaisie({ ...SAISIE, password: "" }, { creation: true }) ?? "", /requis/);
    assert.equal(refusSaisie({ ...SAISIE, password: "" }, { creation: false }), null);
  });
});

describe("saisieDe", () => {
  it("reprend la cible sans jamais remplir le mot de passe", () => {
    const s = saisieDe(cible({ publishStatus: "publish", createCategories: true }));
    assert.equal(s.password, "");
    assert.equal(s.publishStatus, "publish");
    assert.equal(s.createCategories, true);
  });
});

describe("libellés", () => {
  it("dit l'arrivée et le greffon en clair", () => {
    assert.equal(libelleArrivee("draft"), "brouillon");
    assert.equal(libelleArrivee("publish"), "mise en ligne directe");
    assert.equal(libelleGreffon("rankmath"), "Rank Math");
    assert.equal(libelleGreffon("none"), "Aucun greffon SEO");
  });
});

describe("avertissements", () => {
  it("moteur arrêté : le dit, sans prétendre connaître le mode", () => {
    const a = avertissements(etat({ moteurVivant: false, mode: null }));
    assert.equal(a.length, 1);
    assert.match(a[0], /Moteur arrêté/);
    assert.doesNotMatch(a[0], /simulée|activée/);
  });
  it("mode simulé : dit que rien ne part, même avec des cibles", () => {
    const a = avertissements(etat({ mode: "simulated" }));
    assert.equal(a.length, 1);
    assert.match(a[0], /simulée : aucun article ne part/);
  });
  it("mode réel sans cible active ni configuration d'environnement : toute parution sera refusée", () => {
    assert.match(avertissements(etat({ targets: [] })).join(" "), /aucune cible active/);
    assert.match(avertissements(etat({ targets: [cible({ active: false })] })).join(" "), /aucune cible active/);
  });
  it("mode réel avec la configuration d'environnement complète : pas d'alerte de cible", () => {
    assert.deepEqual(avertissements(etat({ targets: [], envConfigured: true })), []);
  });
  it("plusieurs cibles actives et aucune par défaut : alerte", () => {
    const deux = [cible({ id: 1, isDefault: false }), cible({ id: 2, name: "Autre", isDefault: false })];
    assert.match(avertissements(etat({ targets: deux })).join(" "), /aucune par défaut/);
  });
  it("une cible par défaut en mise en ligne directe est signalée", () => {
    assert.match(avertissements(etat({ targets: [cible({ publishStatus: "publish" })] })).join(" "), /sans relecture dans WordPress/);
  });
  it("sans M3_SECRET_KEY : alerte", () => {
    assert.match(avertissements(etat({ secretsAvailable: false })).join(" "), /M3_SECRET_KEY/);
  });
  it("une cible par défaut en brouillon, clé présente : rien à signaler", () => {
    assert.deepEqual(avertissements(etat()), []);
  });
});

describe("conséquences", () => {
  it("la désactivation dit ce qui se passe, et signale la cible par défaut", () => {
    assert.match(consequenceDesactivation("Site", false), /ne recevra plus d'article/);
    assert.match(consequenceDesactivation("Site", true), /cible par défaut/);
    assert.doesNotMatch(consequenceDesactivation("Site", false), /cible par défaut/);
  });
  it("la suppression dit que le mot de passe part et que les articles restent sur WordPress", () => {
    assert.match(consequenceSuppression("Site"), /mot de passe d'application enregistré/);
    assert.match(consequenceSuppression("Site"), /restent sur WordPress/);
  });
});
