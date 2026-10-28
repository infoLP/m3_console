/* Récupération + parsing tolérant de flux RSS/Atom.
   Adapté de rss-aggregator/src/fetch.js (repairFeedXml, dates FR, cleanText, articleId). */

import Parser from "rss-parser";
import { createHash } from "node:crypto";
import { fetchCapped } from "./net.js";
import { fetchArticlePage } from "./page.js";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; M3-prototype/0.1)",
  Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5",
};
const parser = new Parser({ timeout: 15000, headers: HEADERS, maxRedirects: 3 });

export function repairFeedXml(raw) {
  let xml = String(raw).replace(/^[﻿\s]+/, "");
  xml = xml.replace(/<rss\b([^>]*)>/i, (match, attrs) => {
    let a = attrs;
    if (!/\bversion\s*=/i.test(a)) a += ' version="2.0"';
    if (/\batom:/.test(xml) && !/xmlns:atom\s*=/i.test(a)) a += ' xmlns:atom="http://www.w3.org/2005/Atom"';
    return `<rss${a}>`;
  });
  return xml;
}

export async function parseFeed(url, { timeoutMs = 15000 } = {}) {
  const p = timeoutMs === 15000 ? parser : new Parser({ timeout: timeoutMs, headers: HEADERS });
  let body;
  try {
    body = await fetchCapped(url, { timeoutMs, maxBytes: 2 * 1024 * 1024, headers: HEADERS });
  } catch (err) {
    try {
      return await p.parseURL(url);
    } catch {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
  try {
    return await p.parseString(body);
  } catch {
    return await p.parseString(repairFeedXml(body));
  }
}

export function articleId(item) {
  const basis =
    (item.guid && String(item.guid)) ||
    (item.link && String(item.link)) ||
    `${item.title || ""}|${item.isoDate || item.pubDate || ""}`;
  return createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

export function cleanText(str, maxLen = 4000) {
  if (!str) return "";
  const text = String(str)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

const FR_MONTHS = {
  janvier: 0, janv: 0, fevrier: 1, fevr: 1, mars: 2, avril: 3, avr: 3, mai: 4,
  juin: 5, juillet: 6, juil: 6, aout: 7, septembre: 8, sept: 8, octobre: 9, oct: 9,
  novembre: 10, nov: 10, decembre: 11, dec: 11,
};
export function parseFrenchDate(str) {
  const s = String(str).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const m = s.match(/(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?(?:\s*[-–a]\s*(\d{1,2})\s*[:h]\s*(\d{2}))?/);
  if (!m) return null;
  const month = FR_MONTHS[m[2]];
  if (month == null) return null;
  const now = new Date();
  const year = m[3] ? Number(m[3]) : now.getFullYear();
  let d = new Date(year, month, Number(m[1]), m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0);
  if (Number.isNaN(d.getTime())) return null;
  if (!m[3] && d.getTime() - now.getTime() > 2 * 86400 * 1000) d = new Date(year - 1, month, Number(m[1]));
  return d;
}
export function parsePublished(item) {
  const raw = item.isoDate || item.pubDate || item.date || null;
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d;
  return parseFrenchDate(raw);
}

/* Sous ce seuil, le flux ne donne qu'un résumé : on va lire la page de l'item.
   C'est le plancher de longueur de la génération (quality.js) — en dessous,
   l'item serait récolté puis écarté sans appel au modèle. */
export const FULL_TEXT_BELOW = 500;
const MAX_PAGE_FETCHES = 6;

/* Récupère un flux et renvoie des items normalisés (ne throw jamais).
   isSeen(externalId) écarte d'emblée ce qui a déjà été récolté, avant tout
   téléchargement de page. */
export async function harvestFeed(url, { timeoutMs = 15000, maxItems = 15, cutoffMs = 0, isSeen = () => false, fullText = true } = {}) {
  const r = await harvestFeedItems(url, { timeoutMs, maxItems, cutoffMs, isSeen });
  if (!r.ok || !fullText) return r;
  let fetched = 0, completed = 0;
  for (const it of r.items) {
    if (it.rawText.length >= FULL_TEXT_BELOW || !it.link || fetched >= MAX_PAGE_FETCHES) continue;
    fetched++;
    try {
      const page = await fetchArticlePage(it.link, { timeoutMs });
      if (page.rawText.length > it.rawText.length) {
        it.rawText = page.rawText;
        it.publishedAt ||= page.publishedAt;
        completed++;
      }
    } catch { /* on garde le résumé */ }
  }
  r.diag = { via: "rss", links: r.items.length, fetched, completed };
  return r;
}

async function harvestFeedItems(url, { timeoutMs, maxItems, cutoffMs, isSeen }) {
  try {
    const parsed = await parseFeed(url, { timeoutMs });
    let items = (parsed.items || []).map((item) => {
      const pub = parsePublished(item);
      return {
        externalId: articleId(item),
        title: cleanText(item.title, 300) || "(sans titre)",
        link: item.link ? String(item.link).trim() : null,
        publishedAt: pub ? pub.toISOString() : null,
        _ms: pub ? pub.getTime() : 0,
        rawText: cleanText(
          item["content:encoded"] || item.content || item.contentSnippet || item.summary || item.title,
          8000
        ),
        summary: cleanText(item.contentSnippet || item.summary || item.content, 400),
      };
    });
    if (cutoffMs) items = items.filter((it) => !it._ms || it._ms >= cutoffMs);
    items = items.filter((it) => !isSeen(it.externalId));
    items.sort((a, b) => b._ms - a._ms);
    if (maxItems > 0) items = items.slice(0, maxItems);
    return { ok: true, feedTitle: cleanText(parsed.title, 120), items };
  } catch (err) {
    return { ok: false, error: err.message || String(err), items: [] };
  }
}
