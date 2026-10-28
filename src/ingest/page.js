/* Page d'article : téléchargement et extraction du texte principal.
   Partagé par les pages « liste » et par les flux RSS qui ne donnent qu'un
   résumé (Rochefort, DREAL : 70 à 90 caractères par item, sous le plancher de
   500 de la génération — ces items étaient récoltés pour rien). */

import * as cheerio from "cheerio";
import { cleanText } from "./fetchFeed.js";
import { fetchCapped } from "./net.js";
import { publicationDate } from "../generate/dates.js";

export function extractMainText($) {
  const zones = ["article", "main", "[role=main]", ".content", "#content", ".article", ".post"];
  let best = "";
  for (const z of zones) {
    const paras = $(z).find("p").map((_, el) => $(el).text().trim()).get().filter((s) => s.length > 40);
    const text = paras.join("\n\n");
    if (text.length > best.length) best = text;
  }
  if (best.length < 200) {
    best = $("p").map((_, el) => $(el).text().trim()).get().filter((s) => s.length > 40).join("\n\n");
  }
  return cleanText(best, 9000);
}

/* Date de parution écrite dans le texte, pour les pages sans aucune balise de date
   (agglo-larochelle.fr : « Publié le 16 sept. 2024 » dans un <p>, M3-115). Cherchée
   au début de la zone de contenu seulement, jamais dans tout le body : cette page
   affiche en tête des alertes « Publiée le 19 oct. 2026 » qui donneraient à un
   article ancien la date du jour. */
const TEXT_DATE_HEAD = 600;
function publishedFromText($) {
  for (const zone of ["article", "main", "[role=main]"]) {
    const el = $(zone).first();
    if (!el.length) continue;
    const d = publicationDate(el.text().replace(/\s+/g, " ").trim().slice(0, TEXT_DATE_HEAD));
    if (d) return d.toISOString();
  }
  return null;
}

export function publishedOf($) {
  const raw = $("meta[property='article:published_time']").attr("content")
    || $("time[datetime]").first().attr("datetime")
    || $("meta[name='date']").attr("content")
    || "";
  const d = new Date(raw);
  if (raw && !Number.isNaN(d.getTime())) return d.toISOString();
  return publishedFromText($);
}

/* Pages servies à la place de l'article : anti-robot, erreur. Le 2026-10-14,
   APF renvoyait six « Security Check » récoltés comme des articles. */
export const BLOCKED_TITLE = /security check|just a moment|attention required|access denied|acc[eè]s refus[ée]|captcha|page (introuvable|non trouv[ée]e)|not found|erreur 40\d/i;

/* Premier titre non vide : un <h1> présent mais vide donnait « (sans titre »). */
function titleOf($) {
  for (const t of [$("h1").first().text(), $("meta[property='og:title']").attr("content"), $("title").text()]) {
    const c = cleanText(t, 300);
    if (c) return c;
  }
  return "";
}

/* { title, rawText, publishedAt, blocked } ; throw si la page est inaccessible.
   `fetcher` : le repli rendu (M3-57) y passe fetchRendered. */
export async function fetchArticlePage(url, { timeoutMs = 15000, fetcher = fetchCapped } = {}) {
  return parseArticleHtml(await fetcher(url, { timeoutMs, maxBytes: 2 * 1024 * 1024 }));
}

export function parseArticleHtml(html) {
  const $ = cheerio.load(html);
  const title = titleOf($);
  const blocked = BLOCKED_TITLE.test(title) || BLOCKED_TITLE.test($("title").text());
  return {
    title,
    rawText: blocked ? "" : extractMainText($),
    publishedAt: publishedOf($),
    blocked,
  };
}
