import { test } from "node:test";
import assert from "node:assert/strict";
import { cibleFocus, ETAT_INITIAL, messageEchec, transition, type EtatConfirmation } from "./ConfirmationSurPlace.logique";

const CONF: EtatConfirmation = { phase: "confirmation", erreur: null };
const EN_COURS: EtatConfirmation = { phase: "en_cours" };

test("au repos, le clic ouvre la confirmation sans erreur", () => {
  assert.deepEqual(transition(ETAT_INITIAL, { type: "ouvrir" }), CONF);
});

test("au repos, Échap, annuler ou confirmer ne font rien", () => {
  assert.equal(transition(ETAT_INITIAL, { type: "touche", touche: "Escape" }), ETAT_INITIAL);
  assert.equal(transition(ETAT_INITIAL, { type: "annuler" }), ETAT_INITIAL);
  assert.equal(transition(ETAT_INITIAL, { type: "confirmer" }), ETAT_INITIAL);
});

test("en confirmation, Annuler et Échap reviennent au repos", () => {
  assert.deepEqual(transition(CONF, { type: "annuler" }), { phase: "repos" });
  assert.deepEqual(transition(CONF, { type: "touche", touche: "Escape" }), { phase: "repos" });
});

test("en confirmation, une autre touche ne fait rien", () => {
  assert.equal(transition(CONF, { type: "touche", touche: "Enter" }), CONF);
});

test("Confirmer passe en cours, la réussite revient au repos", () => {
  const e = transition(CONF, { type: "confirmer" });
  assert.deepEqual(e, EN_COURS);
  assert.deepEqual(transition(e, { type: "reussite" }), { phase: "repos" });
});

test("pendant l'action, ni Échap ni Annuler ne ferment", () => {
  assert.equal(transition(EN_COURS, { type: "touche", touche: "Escape" }), EN_COURS);
  assert.equal(transition(EN_COURS, { type: "annuler" }), EN_COURS);
  assert.equal(transition(EN_COURS, { type: "confirmer" }), EN_COURS);
});

test("un onConfirm qui échoue revient en confirmation avec l'erreur, et on peut réessayer", () => {
  const e = transition(EN_COURS, { type: "echec", message: "Réseau injoignable" });
  assert.deepEqual(e, { phase: "confirmation", erreur: "Réseau injoignable" });
  assert.deepEqual(transition(e, { type: "confirmer" }), EN_COURS);
  assert.deepEqual(transition(e, { type: "annuler" }), { phase: "repos" });
});

test("focus : Annuler à l'ouverture et après un échec, déclencheur au retour au repos", () => {
  assert.equal(cibleFocus(ETAT_INITIAL, CONF), "annuler");
  assert.equal(cibleFocus(EN_COURS, { phase: "confirmation", erreur: "x" }), "annuler");
  assert.equal(cibleFocus(CONF, { phase: "repos" }), "declencheur");
  assert.equal(cibleFocus(EN_COURS, { phase: "repos" }), "declencheur");
  assert.equal(cibleFocus(CONF, EN_COURS), null);
  assert.equal(cibleFocus(ETAT_INITIAL, ETAT_INITIAL), null);
});

test("message d'échec : celui de l'Error, sinon la chaîne, sinon un texte par défaut", () => {
  assert.equal(messageEchec(new Error("Refusé")), "Refusé");
  assert.equal(messageEchec("Hors délai"), "Hors délai");
  assert.match(messageEchec(undefined), /échoué/);
});
