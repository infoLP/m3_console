// M3-109 (B4) : la conséquence écrite est nominative et le déclencheur est rendu
// (rendu statique : la confirmation ne s'ouvre qu'au clic).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmationSurPlace } from "../../../../composants/primitives";
import { consequencePurge } from "./ListeNotifications.consequences";

const declencheur = (libelle: string, consequence: string) =>
  renderToStaticMarkup(h(ConfirmationSurPlace, { libelle, consequence, onConfirm: () => {} }));


test("purge : dit pour tous, définitivement, avec le nombre", () => {
  assert.match(consequencePurge(3), /Les 3 notifications lues seront supprimées pour tous les utilisateurs/);
  assert.match(consequencePurge(1), /La notification lue sera supprimée/);
  assert.match(consequencePurge(3), /non lues sont conservées/);
  assert.match(declencheur("Purger les lues (3)", consequencePurge(3)), /Purger les lues \(3\)/);
});
