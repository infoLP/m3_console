// M3-109 (B4) : la conséquence écrite est nominative et le déclencheur est rendu
// (rendu statique : la confirmation ne s'ouvre qu'au clic).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmationSurPlace } from "../../../../composants/primitives";
import { consequenceDebannissement } from "./TableauListeNoire.consequences";

const declencheur = (libelle: string, consequence: string) =>
  renderToStaticMarkup(h(ConfirmationSurPlace, { libelle, consequence, onConfirm: () => {} }));


test("liste noire : le débannissement nomme ladresse", () => {
  const c = consequenceDebannissement("203.0.113.7");
  assert.match(c, /L.adresse 203\.0\.113\.7 sera retirée de la liste noire/);
  assert.match(declencheur("Débannir", c), /Débannir/);
});
