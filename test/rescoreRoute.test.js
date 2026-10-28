/* Bouton « Recalculer les scores » du back-office (onglet Dernier run). Le
   handler doit refuser tout autre rôle que l'administrateur AVANT de toucher à
   la base — le recalcul réécrit tout le stock. Appelé directement : la table de
   routes a disparu avec l'ancien serveur (phase 5), le handler est désormais
   branché par une action serveur (lancerExecutions.action.ts). */

import test from "node:test";
import assert from "node:assert/strict";

import { rescoreArticles } from "../src/api/articles.js";

function fakeRes() {
  return {
    status: null, body: null,
    writeHead(s) { this.status = s; },
    end(b) { this.body = b ? JSON.parse(b) : null; },
    setHeader() {},
  };
}

test("un relecteur ou un super utilisateur est refusé, sans accès à la base", async () => {
  for (const role of ["relecteur", "super_utilisateur"]) {
    const res = fakeRes();
    await rescoreArticles({ res, role, body: {} });
    assert.equal(res.status, 403, role);
  }
});
