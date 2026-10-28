/* Ce que le relecteur édite doit arriver jusqu'à la charge utile de publication.
   Constat du 2026-09-17 : la balise titre, la méta-description et les mots-clés
   étaient modifiables, enregistrés, notés au score — et n'atteignaient rien. Le
   corps de l'article non plus. Ce test est là pour que ça ne se reproduise pas
   en silence : il échoue dès qu'un champ éditable cesse d'être transporté. */

import test from "node:test";
import assert from "node:assert/strict";

import { buildPayload } from "../src/publish/payload.js";
import { asBlocks } from "../shared/model.js";

const ARTICLE = {
  id: "art-test-1",
  title: "Le port mise sur l'hydrogène",
  chapo: "Un investissement de 42 millions d'euros d'ici 2028.",
  cat: "Économie",
  body: asBlocks([
    { type: "p", text: "Premier paragraphe." },
    { type: "h2", text: "Un investissement lourd" },
    { type: "p", text: "Second paragraphe." },
  ]),
  seo: {
    metaTitle: "Hydrogène vert : le port investit 42 M€",
    metaDescription: "d".repeat(100),
    slug: "port-hydrogene-vert",
    keywords: ["hydrogène", "port", "décarbonation"],
  },
};
const SETTINGS = { wp_target: "https://wordpress.exemple.fr" };

test("aucun champ éditable ne se perd en route", () => {
  const p = buildPayload(ARTICLE, SETTINGS);
  assert.equal(p.title, ARTICLE.title);
  assert.equal(p.slug, ARTICLE.seo.slug);
  assert.equal(p.excerpt, ARTICLE.chapo);
  assert.deepEqual(p.categories, ["Économie"]);
  assert.deepEqual(p.tags, ARTICLE.seo.keywords);
  assert.equal(p.seo.metaTitle, ARTICLE.seo.metaTitle);
  assert.equal(p.seo.metaDescription, ARTICLE.seo.metaDescription);
});

test("le corps part en HTML, intertitres compris", () => {
  const p = buildPayload(ARTICLE, SETTINGS);
  assert.match(p.content, /<h2>Un investissement lourd<\/h2>/);
  assert.match(p.content, /<p>Premier paragraphe\.<\/p>/);
  assert.deepEqual(p.seo.outline, [
    "H1 Le port mise sur l'hydrogène",
    "H2 Un investissement lourd",
  ]);
});

test("une parution planifiée part en statut future, datée", () => {
  const quand = "2026-10-01T09:00:00.000Z";
  const p = buildPayload(ARTICLE, SETTINGS, { scheduledAt: quand });
  assert.equal(p.status, "future");
  assert.equal(p.date, quand);

  const now = buildPayload(ARTICLE, SETTINGS);
  assert.equal(now.status, "publish");
  assert.equal(now.date, null);
});

test("un article sans métadonnées ne fait pas tomber l'assemblage", () => {
  const p = buildPayload({ id: "x", title: "T", body: [] }, SETTINGS);
  assert.equal(p.excerpt, "");
  assert.equal(p.seo.metaTitle, "");
  assert.deepEqual(p.tags, []);
  assert.deepEqual(p.categories, []);
});
