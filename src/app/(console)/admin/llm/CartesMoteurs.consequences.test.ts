// M3-109 (B4) : la conséquence écrite est nominative et le déclencheur est rendu
// (rendu statique : la confirmation ne s'ouvre qu'au clic).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmationSurPlace } from "../../../../composants/primitives";
import { consequenceRetraitCle, consequenceRetraitSecours, consequenceSuppressionMoteur } from "./CartesMoteurs.consequences";

const declencheur = (libelle: string, consequence: string) =>
  renderToStaticMarkup(h(ConfirmationSurPlace, { libelle, consequence, onConfirm: () => {} }));


test("moteur : suppression nominative, avec le sort du moteur actif", () => {
  assert.match(consequenceSuppressionMoteur("OpenRouter", false), /« OpenRouter » et sa clé d.API enregistrée seront supprimés/);
  assert.doesNotMatch(consequenceSuppressionMoteur("OpenRouter", false), /moteur actif/);
  assert.match(consequenceSuppressionMoteur("OpenRouter", true), /moteur actif.*mock/);
  const html = declencheur("Supprimer", consequenceSuppressionMoteur("OpenRouter", true));
  assert.match(html, /<button[^>]*>.*Supprimer/s);
  assert.doesNotMatch(html, /OpenRouter/); // la conséquence n apparaît qu au clic
});

test("moteur : retrait de la clé et du secours nomment le moteur", () => {
  assert.match(consequenceRetraitCle("OpenAI"), /clé d.API de « OpenAI » sera effacée/);
  assert.match(consequenceRetraitSecours("OpenAI"), /« OpenAI » ne sera plus le moteur de secours.*mock/);
});
