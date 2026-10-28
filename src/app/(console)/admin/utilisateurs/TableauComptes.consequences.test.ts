// M3-109 (B4) : la conséquence écrite est nominative et le déclencheur est rendu
// (rendu statique : la confirmation ne s'ouvre qu'au clic).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmationSurPlace } from "../../../../composants/primitives";
import { consequenceMotDePasse, consequenceRetraitCompte } from "./TableauComptes.consequences";

const declencheur = (libelle: string, consequence: string) =>
  renderToStaticMarkup(h(ConfirmationSurPlace, { libelle, consequence, onConfirm: () => {} }));


test("compte : le retrait dit que la suppression a lieu à lenregistrement", () => {
  const c = consequenceRetraitCompte({ name: "Paul Martin", login: "p.martin@legalprime.fr" });
  assert.match(c, /« Paul Martin » sera supprimé à l.enregistrement/);
  assert.match(consequenceRetraitCompte({ login: "x@y.fr" }), /« x@y.fr »/);
  assert.match(declencheur("Retirer", c), /Retirer/);
});

test("compte : le mot de passe dit que les sessions sont fermées", () => {
  const c = consequenceMotDePasse({ name: "Paul Martin" });
  assert.match(c, /« Paul Martin » sera remplacé/);
  assert.match(c, /sessions ouvertes seront fermées/);
});
