/* M3-115 — une page sans balise de date était récoltée sans date, donc jamais écartée
   par le filtre de récolte. Run du 2026-10-26 : « Yélo détaille ses solutions pour
   circuler dans l'Agglo » (agglo-larochelle.fr), page du 16 septembre 2024, générée
   comme une nouveauté. La date n'y existe qu'en texte, dans un <p> : « Publié le 16
   sept. 2024 - Mis à jour le 17 sept. 2024 ». Le même site affiche en tête de chaque
   page des alertes « Publiée le 19 oct. 2026 », hors de la zone de contenu. */

import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";

import { publicationDate } from "../src/generate/dates.js";
import { publishedOf } from "../src/ingest/page.js";

/* Jour calendaire d'une date ISO, lu comme la lisent les contrôles (heure locale). */
function ymd(iso) {
  const d = new Date(iso);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
}

const ALERTES = `<aside class="alert-notif">
  <p class="alert-notif-entry">Périgny : travaux <span class="alert-notif-date">Publiée le 19 oct. 2026</span></p>
  <p class="alert-notif-entry">Saint-Xandre : RD 107 <span class="alert-notif-date">Publiée le 19 oct. 2026</span></p>
</aside>`;

const page = (corps, tete = "") => cheerio.load(`<html><head>${tete}</head><body>${ALERTES}${corps}</body></html>`);

test("publicationDate : la parution, pas la mise à jour", () => {
  const d = publicationDate("Publié le 16 sept. 2024 - Mis à jour le 17 sept. 2024");
  assert.equal(ymd(d.toISOString()), "2024-9-16");
  assert.equal(publicationDate("Mis à jour le 17 sept. 2024"), null);
});

test("publicationDate : variantes d'étiquette", () => {
  assert.equal(ymd(publicationDate("Mis en ligne le 1er octobre 2026").toISOString()), "2026-10-1");
  assert.equal(ymd(publicationDate("Date de publication : 3 mars 2026").toISOString()), "2026-3-3");
  assert.equal(ymd(publicationDate("Publiée le 19 oct. 2026").toISOString()), "2026-10-19");
});

test("publicationDate : une date sans étiquette de parution n'en est pas une (M3-71)", () => {
  assert.equal(publicationDate("Réunion d'information le 17 décembre 2026 à Saintes."), null);
  assert.equal(publicationDate("avant le 15 mai 2027 auprès de la DDTM"), null);
});

test("publishedOf : date en texte dans l'article, alertes du bandeau ignorées", () => {
  const $ = page(`<main><article><h1>Déplacez-vous autrement</h1>
    <p class="news-list-news-date"> Publié le 16 sept. 2024 - Mis à jour le 17 sept. 2024 </p>
    <p>Le Challenge de la Mobilité est organisé le lundi 16 septembre 2024.</p></article></main>`);
  assert.equal(ymd(publishedOf($)), "2024-9-16");
});

test("publishedOf : la page n'a que les alertes, pas de date d'article → null", () => {
  const $ = page(`<main><article><h1>Sans date</h1><p>Texte de l'article.</p></article></main>`);
  assert.equal(publishedOf($), null);
});

test("publishedOf : une balise de date prime sur le texte", () => {
  const $ = page(
    `<article><p>Publié le 16 sept. 2024</p></article>`,
    `<meta property="article:published_time" content="2026-10-20T08:00:00Z">`
  );
  assert.equal(publishedOf($), "2026-10-20T08:00:00.000Z");
});

test("publishedOf : une étiquette loin du début de l'article n'est pas la parution", () => {
  const long = "Un long paragraphe d'introduction. ".repeat(30);
  const $ = page(`<article><p>${long}</p><p>Le texte officiel a été publié le 3 mars 2025 au journal officiel.</p></article>`);
  assert.equal(publishedOf($), null);
});

test("publishedOf : hors zone de contenu, le texte n'est pas lu", () => {
  const $ = cheerio.load(`<html><body><div>Publié le 16 sept. 2024</div></body></html>`);
  assert.equal(publishedOf($), null);
});
