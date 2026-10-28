/* Repli sur le sitemap quand une page « liste » ne donne aucun lien d'article
   (page rendue en JavaScript, gabarit inhabituel). Le 2026-10-14, 30 des 34
   sources actives publiaient un sitemap ; le <lastmod> donne en plus la
   fraîcheur, que la page liste ne donne pas. */

import { fetchCapped } from "./net.js";
import { scoreLink, newsPath } from "./links.js";

export const CHILD_HINT = /(post|actu|news|article|communique|presse|page)/i;

export function parseSitemap(xml) {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const blocks = String(xml).match(isIndex ? /<sitemap>[\s\S]*?<\/sitemap>/gi : /<url>[\s\S]*?<\/url>/gi) || [];
  const entries = blocks.map((b) => {
    const loc = (b.match(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/i) || [])[1]?.trim();
    const lm = (b.match(/<lastmod>\s*([^<]+)/i) || [])[1]?.trim();
    const t = lm ? Date.parse(lm) : NaN;
    return loc ? { loc: loc.replace(/&amp;/g, "&"), lastmod: Number.isNaN(t) ? 0 : t } : null;
  }).filter(Boolean);
  return { isIndex, entries };
}

/* Texte lisible tiré du slug, pour noter un lien qui n'a pas de libellé. */
export function slugText(u) {
  try {
    const last = new URL(u).pathname.replace(/\/+$/, "").split("/").pop() || "";
    return decodeURIComponent(last).replace(/\.\w+$/, "").replace(/[-_]+/g, " ");
  } catch { return ""; }
}

async function getText(url, timeoutMs) {
  try { return await fetchCapped(url, { timeoutMs, maxBytes: 3 * 1024 * 1024 }); } catch { return null; }
}

/* URLs d'articles récents, plus récentes d'abord. Ne throw jamais. */
export async function recentFromSitemap(pageUrl, { timeoutMs = 15000, cutoffMs = Date.now() - 30 * 86400000, max = 20 } = {}) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return []; }
  const roots = [];
  const robots = await getText(origin + "/robots.txt", timeoutMs);
  if (robots) for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) roots.push(m[1]);
  roots.push(origin + "/sitemap.xml", origin + "/sitemap_index.xml", origin + "/wp-sitemap.xml");

  for (const root of [...new Set(roots)]) {
    const xml = await getText(root, timeoutMs);
    if (!xml || !/<(urlset|sitemapindex)[\s>]/i.test(xml)) continue;
    let { isIndex, entries } = parseSitemap(xml);
    if (isIndex) {
      /* Au plus quatre sous-sitemaps : ceux dont le nom évoque des contenus, puis
         les plus récemment modifiés. */
      const children = entries
        .sort((a, b) => (CHILD_HINT.test(b.loc) - CHILD_HINT.test(a.loc)) || b.lastmod - a.lastmod)
        .slice(0, 4);
      entries = [];
      for (const c of children) {
        const sub = await getText(c.loc, timeoutMs);
        if (sub) entries.push(...parseSitemap(sub).entries);
      }
    }
    return entries
      .filter((e) => e.lastmod >= cutoffMs && newsPath(e.loc) && (scoreLink(e.loc, slugText(e.loc), pageUrl) ?? 0) >= 3)
      .sort((a, b) => b.lastmod - a.lastmod)
      .slice(0, max)
      .map((e) => ({ url: e.loc, lastmod: new Date(e.lastmod).toISOString() }));
  }
  return [];
}
