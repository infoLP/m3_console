import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { affichage, champsConnexion, cheminInterne, messageErreurSso } from "./seConnecter.regles";

describe("cheminInterne", () => {
  it("garde un chemin interne et refuse tout tremplin", () => {
    assert.equal(cheminInterne("/console"), "/console");
    assert.equal(cheminInterne("/admin?tab=runs"), "/admin?tab=runs");
    assert.equal(cheminInterne("/"), "/");
    assert.equal(cheminInterne(null), "/");
    assert.equal(cheminInterne(""), "/");
    assert.equal(cheminInterne("https://evil.example/"), "/");
    assert.equal(cheminInterne("//evil.example/"), "/", "double barre = URL relative au protocole");
    assert.equal(cheminInterne("/\\evil.example"), "/");
  });
});

describe("messageErreurSso", () => {
  it("traduit un code connu, et donne un message générique sinon", () => {
    assert.match(messageErreurSso("sso_inconnu") ?? "", /aucun compte M3/);
    assert.equal(messageErreurSso("n_importe_quoi"), "La connexion a échoué.");
    assert.equal(messageErreurSso(null), null);
  });
});

describe("affichage", () => {
  it("formulaire seul tant qu'Entra n'est pas configuré, ou si les modes sont inconnus", () => {
    assert.deepEqual(affichage({ local: true, entra: false }).sso, false);
    assert.equal(affichage(null).formulaire, true);
    assert.equal(affichage(null).sso, false);
  });
  it("les deux cohabitent : « ou » et mot de passe en secondaire", () => {
    const a = affichage({ local: true, entra: true });
    assert.equal(a.ou, true);
    assert.equal(a.motDePasseSecondaire, true);
  });
  it("mode entra : plus de formulaire, et la note le dit", () => {
    const a = affichage({ local: false, entra: true });
    assert.equal(a.formulaire, false);
    assert.match(a.note, /désactivée/);
  });
});

describe("champsConnexion", () => {
  it("exige les deux champs et nettoie l'identifiant", () => {
    assert.deepEqual(champsConnexion({ login: "  a@x.fr ", password: "p" }), { login: "a@x.fr", password: "p" });
    assert.match((champsConnexion({ login: "a", password: "" }) as { erreur: string }).erreur, /requis/);
    assert.match((champsConnexion({}) as { erreur: string }).erreur, /requis/);
  });
});
