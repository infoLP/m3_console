// Les routes que le navigateur appelle encore (lectures sondées, article
// ouvert, erreurs client, sonde de santé) doivent exister sous src/app/api :
// en supprimer une par mégarde casserait un écran sans qu'aucun type ne le
// dise. Tout le reste passe par des actions serveur depuis la phase 5.
//
// Et roleDemande() : la commodité « Voir comme » ne doit jamais dégrader un
// administrateur qui n'a rien demandé, ni promouvoir qui que ce soit d'autre.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ROLES } from "../shared/model.js";

const APP = join(import.meta.dirname, "app");

/* Chemin → méthodes attendues. Ce que relireArticles.client.ts, le sondage du
   back-office, RemonteeErreurs et le healthcheck Docker appellent. */
const ENCORE_APPELEES: Record<string, string[]> = {
  "api/health": ["GET"],
  "api/articles": ["GET"],
  "api/articles/[id]": ["GET"],
  "api/history": ["GET"],
  "api/stats": ["GET"],
  "api/notifications": ["GET"],
  "api/runs": ["GET"],
  "api/client-error": ["POST"],
  "auth/login": ["GET"],
  "auth/callback": ["GET"],
  "site-icon": ["GET"],
  "favicon.ico": ["GET"],
};

describe("routes encore appelées par le navigateur", () => {
  for (const [chemin, methodes] of Object.entries(ENCORE_APPELEES)) {
    it(chemin, () => {
      const f = join(APP, ...chemin.split("/"), "route.ts");
      assert.ok(existsSync(f), `fichier attendu : ${f}`);
      const src = readFileSync(f, "utf8");
      for (const m of methodes) assert.match(src, new RegExp(`export const ${m} = `), `${chemin} doit exporter ${m}`);
    });
  }
});

describe("roleDemande", () => {
  /* src/pont.ts charge next/headers, qui n'existe qu'en contexte Next : on ne
     teste que la règle, copiée telle quelle depuis roleDemande(). */
  const roleDemande = (u: { role: string } | null, enTete: string | null) => {
    if (!u) return "relecteur";
    if (u.role !== "administrateur") return u.role;
    const d = (enTete || "").toLowerCase();
    return d in ROLES ? d : u.role;
  };
  it("sans session : relecteur", () => { assert.equal(roleDemande(null, "administrateur"), "relecteur"); });
  it("un non-administrateur garde son rôle, quoi qu'il demande", () => {
    assert.equal(roleDemande({ role: "relecteur" }, "administrateur"), "relecteur");
  });
  it("un administrateur sans en-tête reste administrateur", () => {
    assert.equal(roleDemande({ role: "administrateur" }, null), "administrateur");
    assert.equal(roleDemande({ role: "administrateur" }, "inconnu"), "administrateur");
  });
  it("un administrateur peut « voir comme »", () => {
    assert.equal(roleDemande({ role: "administrateur" }, "Relecteur"), "relecteur");
  });
});
