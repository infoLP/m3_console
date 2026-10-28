/* `rescore` doit reconnaître un score inchangé, quel que soit l'ordre des clés.
 *
   Constat du 2026-09-17 : l'outil comparait `JSON.stringify(avant)` à
   `JSON.stringify(après)`. Or `doc` est stocké en jsonb, et PostgreSQL y
   réordonne les clés — par longueur, puis par octets. Un score relu ne sortait
   donc jamais dans l'ordre que produit `scoreSummary`, les deux chaînes ne
   coïncidaient jamais, et l'outil annonçait tout le stock « à reprendre » à
   chaque passage. `--dry` disait toujours la même chose : il ne valait plus
   comme signal.

   Rien n'était corrompu — les scores écrits étaient justes — mais le diagnostic
   était aveugle, et le défaut a vécu depuis la bascule PostgreSQL sans que rien
   ne le signale. Ce test échoue si quelqu'un revient un jour à une comparaison
   de chaînes. */

import test from "node:test";
import assert from "node:assert/strict";

import { scoresEqual } from "../src/tools/rescore.js";

/* L'ordre que rend PostgreSQL : clés triées par longueur, puis par octets. */
const RELU_DE_LA_BASE = {
  seo: "conforme",
  ready: false,
  editorial: 68,
  conformity: { total: 5, passed: 3, detail: { seo: true, source: true, longueur: false } },
  editorialBand: "aligne",
};

/* Le même score, dans l'ordre où `scoreSummary` le construit. */
const RECALCULE = {
  editorial: 68,
  editorialBand: "aligne",
  seo: "conforme",
  conformity: { passed: 3, total: 5, detail: { longueur: false, seo: true, source: true } },
  ready: false,
};

test("un score relu depuis jsonb est reconnu identique au score recalculé", () => {
  assert.equal(scoresEqual(RELU_DE_LA_BASE, RECALCULE), true);
});

test("l'ordre des clés imbriquées ne compte pas non plus", () => {
  assert.equal(
    scoresEqual({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }),
    true
  );
});

test("une valeur réellement différente reste détectée", () => {
  const modifie = { ...RECALCULE, editorial: 71 };
  assert.equal(scoresEqual(RELU_DE_LA_BASE, modifie), false);
});

test("un critère de conformité qui bascule est détecté", () => {
  const modifie = {
    ...RECALCULE,
    conformity: { ...RECALCULE.conformity, passed: 4, detail: { ...RECALCULE.conformity.detail, longueur: true } },
  };
  assert.equal(scoresEqual(RELU_DE_LA_BASE, modifie), false);
});

/* Le point où un tri trop zélé casserait tout : un tableau porte son ordre. */
test("l'ordre d'un tableau compte, lui", () => {
  assert.equal(scoresEqual({ mots: ["port", "hydrogène"] }, { mots: ["hydrogène", "port"] }), false);
  assert.equal(scoresEqual({ mots: ["port", "hydrogène"] }, { mots: ["port", "hydrogène"] }), true);
});

test("une clé en plus n'est pas un score identique", () => {
  assert.equal(scoresEqual({ a: 1 }, { a: 1, b: 2 }), false);
});

test("un article jamais noté se distingue d'un score vide", () => {
  assert.equal(scoresEqual(null, {}), false);
  assert.equal(scoresEqual(null, null), true);
});
