/* Récupération best-effort d'une page "liste d'articles / communiqués".
   Extrait des liens candidats puis le texte principal de chaque article.
   Fragile par nature : un sélecteur CSS par source (champ `selector`) peut surcharger.

   Trois corrections du 2026-10-14 (17 sources actives sur 34 muettes) :
   - les liens de navigation sont écartés et les candidats notés (links.js) ;
   - un lien DÉJÀ VU ne consomme plus le budget de pages : avant, les six pages
     suivies étaient toujours les six mêmes premiers liens, et les nouveaux
     articles plus bas sur la page n'étaient jamais atteints ;
   - aucune piste sur la page → repli sur le sitemap (sitemap.js).

   Repli rendu (M3-57, désactivé par défaut) : voir harvestArticleList. */

import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { fetchCapped } from "./net.js";
import { NAV_ZONES, pickArticleLinks } from "./links.js";
import { fetchArticlePage } from "./page.js";
import { fetchRendered } from "./fetchRendered.js";
import { recentFromSitemap } from "./sitemap.js";

const MAX_PAGES = 6; // nb max de pages d'article NOUVELLES suivies par source-liste
const MIN_TEXT = 200;

export const linkId = (u) => createHash("sha1").update(u).digest("hex").slice(0, 16);

/* Liens candidats d'une page liste. Exporté pour les tests. */
export function listLinks(html, listUrl, selector) {
  const $ = cheerio.load(html);
  if (selector) {
    const hrefs = $(selector).map((_, el) => $(el).attr("href") || $(el).find("a").attr("href")).get();
    return [...new Set(hrefs.map((h) => { try { return new URL(h, listUrl).toString(); } catch { return null; } }).filter(Boolean))];
  }
  const candidates = $("a[href]")
    .filter((_, el) => $(el).closest(NAV_ZONES).length === 0)
    .map((_, el) => ({ href: $(el).attr("href"), text: $(el).text() || $(el).attr("title") || "" }))
    .get();
  return pickArticleLinks(candidates, listUrl);
}

/* Page dont le contenu est construit par JavaScript : coquille vide d'application
   (#root, #app, #__next…) ou <noscript> qui réclame JavaScript, et presque pas de
   texte. Exporté pour les tests. */
const JS_ROOT = /<div[^>]+id=["'](root|app|__next|__nuxt|___gatsby)["'][^>]*>\s*<\/div>/i;
const NOSCRIPT_JS = /<noscript[^>]*>[^<]*(javascript|js)[^<]*<\/noscript>/i;
export function looksJsRendered(html) {
  if (!JS_ROOT.test(html) && !NOSCRIPT_JS.test(html)) return false;
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim().length < 500;
}

/* Une passe : liens de la page liste, puis pages d'article suivies avec `fetcher`. */
async function collect(html, listUrl, { fetcher, timeoutMs, pageCap, selector, isSeen, cutoffMs, sitemap }) {
  let urls = listLinks(html, listUrl, selector);
  let via = selector ? "selector" : "list";
  if (!urls.length && !selector && sitemap) {
    const recent = await recentFromSitemap(listUrl, { timeoutMs, cutoffMs: cutoffMs || Date.now() - 30 * 86400000 });
    urls = recent.map((r) => r.url);
    via = "sitemap";
  }

  const items = [];
  let seenSkipped = 0, thin = 0, old = 0;
  for (const u of urls) {
    if (items.length >= pageCap) break;
    const externalId = linkId(u);
    if (isSeen(externalId)) { seenSkipped++; continue; }
    try {
      const page = await fetchArticlePage(u, { timeoutMs, fetcher });
      if (page.rawText.length < MIN_TEXT) { thin++; continue; }
      /* Même règle que les flux : un contenu DATÉ d'avant la fenêtre n'est pas
         une actualité (la Région ressortait une commission permanente de 2020).
         Sans date, on garde — la plupart des pages n'en exposent pas. */
      if (cutoffMs && page.publishedAt && Date.parse(page.publishedAt) < cutoffMs) { old++; continue; }
      items.push({
        externalId,
        title: page.title || "(sans titre)",
        link: u,
        publishedAt: page.publishedAt,
        rawText: page.rawText,
        summary: page.rawText.slice(0, 400),
      });
    } catch { /* page ignorée */ }
  }
  return { items, diag: { via, links: urls.length, seenSkipped, thin, old } };
}

/* La passe furtive a-t-elle lu la source ? Des articles, ou des liens qui ne sont
   écartés que parce que déjà vus ou trop anciens. Sinon : muette ou bloquée. */
const readable = (d, items) => items.length > 0 || d.seenSkipped > 0 || d.old > 0;

/* isSeen(externalId) → true si l'item a déjà été récolté pour cette source.

   Repli rendu (M3-57) : `render` (défaut : non ; harvestRun le lit du réglage
   harvest_render_fallback, voir rendererFor) refait avec `renderer` la page
   liste et ses articles dans un navigateur headless quand la passe statique n'a
   rien donné d'exploitable — page liste en 403, 0 lien, 0 article (sans compter
   les déjà vus ni les trop anciens) ou page construite en JavaScript. Ce rendu
   garde l'agent M3, sans camouflage : un refus qui persiste reste un échec.
   Les autres erreurs HTTP et réseau n'en déclenchent pas.
   Échec du repli : le résultat statique est rendu tel quel, avec diag.render.

   Furtif (`stealth`, réglage « furtif », décision de l'utilisateur du 2026-10-26) :
   un 403 est retenté avec le crawler camouflé, à la place du rendu. Le résultat
   porte `furtif` : "ok" (la source se lit : harvestRun l'inscrit en liste blanche)
   ou "refus" (toujours refusée, muette ou bloquée : harvestRun la met à l'écart).
   `stealthFirst` (source en liste blanche) : tout passe d'emblée par le furtif ;
   lu sans rien de lisible ou en échec, c'est aussi un "refus" (T6).
   `stealthRecheck` (T6, une fois par semaine) : un fetch ordinaire d'abord ; s'il
   passe, le 403 a disparu, la source est récoltée normalement et le résultat porte
   `furtif: "sortie"` (harvestRun la retire de la liste blanche).
   `known` : HTML de la page liste déjà obtenu (usage interne). */
export async function harvestArticleList(listUrl, opts = {}) {
  const { timeoutMs = 15000, maxItems = 8, selector, isSeen = () => false, cutoffMs = 0, render = false, renderer = fetchRendered, stealth = null, stealthFirst = false, stealthRecheck = false, known = null } = opts;
  const pageCap = Math.min(maxItems, MAX_PAGES);
  const pass = { timeoutMs, pageCap, selector, isSeen, cutoffMs };
  if (stealth && stealthFirst) {
    if (stealthRecheck) {
      let plain = null;
      try { plain = await fetchCapped(listUrl, { timeoutMs, maxBytes: 2 * 1024 * 1024 }); } catch { /* 403 ou autre : on reste en furtif */ }
      if (plain != null) return { ...(await harvestArticleList(listUrl, { ...opts, stealthFirst: false, stealthRecheck: false, known: plain })), furtif: "sortie" };
    }
    try {
      const page = await stealth(listUrl, { timeoutMs: timeoutMs * 2 });
      const r = await collect(page, listUrl, { ...pass, fetcher: stealth, sitemap: false });
      if (!readable(r.diag, r.items)) return { ok: false, error: "furtif : aucun article lisible", items: [], furtif: "refus" };
      return { ok: true, items: r.items, diag: { ...r.diag, via: "furtif", furtif: "liste" } };
    } catch (err) {
      return { ok: false, error: `furtif : ${err.message || err}`, items: [], furtif: "refus" };
    }
  }
  let html = known;
  if (html == null) try {
    html = await fetchCapped(listUrl, { timeoutMs, maxBytes: 2 * 1024 * 1024 });
  } catch (err) {
    const error = err.message || String(err);
    if (error !== "HTTP 403") return { ok: false, error, items: [] };
    if (stealth) {
      try {
        const page = await stealth(listUrl, { timeoutMs: timeoutMs * 2 });
        const r = await collect(page, listUrl, { ...pass, fetcher: stealth, sitemap: false });
        if (readable(r.diag, r.items)) {
          return { ok: true, items: r.items, furtif: "ok", diag: { ...r.diag, via: "furtif", render: "http-403", furtif: "ok" } };
        }
        return { ok: false, error: `${error} (furtif : aucun article lisible)`, items: [], furtif: "refus" };
      } catch (e) {
        return { ok: false, error: `${error} (furtif : ${e.message || e})`, items: [], furtif: "refus" };
      }
    }
    if (!render) return { ok: false, error, items: [] };
    try {
      const rendered = await renderer(listUrl, { timeoutMs: timeoutMs * 2 });
      const second = await collect(rendered, listUrl, { ...pass, fetcher: renderer, sitemap: false });
      return { ok: true, items: second.items, diag: { ...second.diag, via: "rendered", render: "http-403" } };
    } catch (e) {
      return { ok: false, error: `${error} (repli : ${e.message || e})`, items: [] };
    }
  }
  try {
    const first = await collect(html, listUrl, { ...pass, fetcher: fetchCapped, sitemap: true });
    const d = first.diag;
    const reason = !render ? null
      : looksJsRendered(html) && !first.items.length ? "js"
      : !d.links ? "no-links"
      : !first.items.length && !d.seenSkipped && !d.old ? "no-items"
      : null;
    if (!reason) return { ok: true, items: first.items, diag: d };

    try {
      const rendered = await renderer(listUrl, { timeoutMs: timeoutMs * 2 });
      const second = await collect(rendered, listUrl, { ...pass, fetcher: renderer, sitemap: false });
      if (!second.items.length && second.diag.links <= d.links) {
        return { ok: true, items: first.items, diag: { ...d, render: `${reason} : rien de plus` } };
      }
      return { ok: true, items: second.items, diag: { ...second.diag, via: "rendered", render: reason, staticDiag: d } };
    } catch (err) {
      return { ok: true, items: first.items, diag: { ...d, render: `${reason} : ${err.message || err}` } };
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err), items: [] };
  }
}
