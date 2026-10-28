/* Concurrents (M3-119, lot 2 = M3-121) : lire les articles récents d'un site
   concurrent et en tirer les domaines qu'il cite, candidats à notre référentiel.

   - Fonctions pures, plus un crawler à `fetcher` injectable. Aucune écriture en
     base, aucun branchement à l'ordonnanceur : stockage et fréquence viendront
     avec la table des concurrents (lot 1, M3-120).
   - Le référentiel est passé en paramètre (`known`) : liste de domaines, d'URL ou
     de sources ({ rssUrl, listUrl, … }), jamais lu ici.
   - Articles par la page liste, sinon le flux RSS/Atom, sinon le sitemap
     (voir crawlCompetitor).
   - robots.txt (RFC 9309) de l'hôte respecté pour chaque requête, Crawl-delay compris.
   - Volume borné : au plus `maxArticles` articles par concurrent et `maxProbes`
     requêtes de recherche par voie (flux, sitemap), espacées de `delayMs`.
   - Domaine = domaine enregistrable : www et sous-domaines repliés
     (presse.exemple.fr → exemple.fr), sauf sous un suffixe public : ceux de la
     liste PUBLIC_SUFFIXES (prefecture.gouv.fr reste prefecture.gouv.fr) et, sous
     un TLD de pays, les seconds niveaux génériques (maariv.co.il, x.com.tr). */

import * as cheerio from "cheerio";
import { fetchCapped } from "./net.js";
import Parser from "rss-parser";
import { NAV_ZONES, scoreLink, newsPath } from "./links.js";
import { listLinks } from "./fetchArticleList.js";
import { parseArticleHtml } from "./page.js";
import { repairFeedXml } from "./fetchFeed.js";
import { feedLinksIn, COMMON_PATHS } from "./discoverFeeds.js";
import { parseSitemap, slugText, CHILD_HINT } from "./sitemap.js";

/* Jeton de notre robot dans robots.txt, celui de l'agent utilisateur de net.js. */
const AGENT = "m3-prototype";

/* Suffixes publics à deux niveaux qu'on rencontre dans nos sources : sous eux, un
   sous-domaine est un organisme à part entière. Liste explicite (pas de
   dépendance à la Public Suffix List). */
const PUBLIC_SUFFIXES = new Set([
  "gouv.fr", "asso.fr", "com.fr", "presse.fr", "tm.fr", "nom.fr", "cci.fr", "notaires.fr", "avocat.fr", "europa.eu",
  "co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "co.jp", "com.br", "co.nz",
]);

/* Seconds niveaux génériques des TLD de pays (co.il, com.tr, org.za, gob.mx…) :
   sous un TLD à deux lettres, ils sont des suffixes publics, sans en dresser la
   liste pays par pays. Approximation assumée de la Public Suffix List (T13). */
const GENERIC_SLD = new Set([
  "co", "com", "net", "org", "gov", "gouv", "edu", "ac", "asso", "nom", "ltd", "plc",
  "or", "ne", "go", "gob", "mil", "gv", "sch", "biz", "info",
]);
const publicSuffix = (sld, tld) => PUBLIC_SUFFIXES.has(`${sld}.${tld}`) || (/^[a-z]{2}$/.test(tld) && GENERIC_SLD.has(sld));

/* Réseaux sociaux, partage, raccourcisseurs, CDN et outils de page : jamais des sources. */
export const IGNORED_DOMAINS = new Set([
  // réseaux sociaux et messageries
  "facebook.com", "fb.com", "fb.me", "twitter.com", "x.com", "t.co", "linkedin.com", "lnkd.in", "instagram.com",
  "youtube.com", "youtu.be", "tiktok.com", "pinterest.com", "pinterest.fr", "snapchat.com", "threads.net",
  "bsky.app", "mastodon.social", "whatsapp.com", "wa.me", "telegram.org", "t.me", "reddit.com", "dailymotion.com",
  "vimeo.com", "flickr.com", "tumblr.com", "messenger.com",
  // partage et raccourcisseurs
  "addtoany.com", "sharethis.com", "addthis.com", "bit.ly", "ow.ly", "tinyurl.com", "buff.ly", "goo.gl",
  // CDN, polices, mesure d'audience, moteurs de site
  "cloudflare.com", "jsdelivr.net", "unpkg.com", "googleapis.com", "gstatic.com", "googletagmanager.com",
  "google-analytics.com", "doubleclick.net", "cloudfront.net", "amazonaws.com", "akamaihd.net", "gravatar.com",
  "wp.com", "w.org", "wordpress.org", "wordpress.com", "google.com", "apple.com", "matomo.org",
]);

/* Domaine enregistrable d'un nom d'hôte, sans www ; "" si ce n'est pas un nom de
   domaine, ou si c'est un suffixe public seul (co.il, gouv.fr). */
export function registrableDomain(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!h || /^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".")) return "";
  const labels = h.split(".");
  if (publicSuffix(labels.at(-2), labels.at(-1))) return labels.length >= 3 ? labels.slice(-3).join(".") : "";
  return labels.slice(-2).join(".");
}

/* Domaine enregistrable d'une URL (ou d'un nom d'hôte nu) ; "" si illisible. */
export function domainOf(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(s) ? s : `https://${s}`);
    return /^https?:$/.test(url.protocol) ? registrableDomain(url.hostname) : "";
  } catch { return ""; }
}

/* Domaines du référentiel : chaînes (domaine ou URL) ou sources, dont chaque
   valeur http(s) compte (rssUrl, listUrl, pressUrl, siteUrl…). */
export function referenceDomains(known = []) {
  const out = new Set();
  for (const k of known) {
    const values = typeof k === "string" ? [k] : Object.values(k || {}).filter((v) => typeof v === "string" && /^https?:\/\//i.test(v));
    for (const v of values) { const d = domainOf(v); if (d) out.add(d); }
  }
  return out;
}

/* robots.txt → { allowed(path), crawlDelayMs } pour notre agent (RFC 9309) :
   groupe de notre agent s'il existe, sinon celui de « * » ; règle la plus longue
   gagnante, Allow à égalité ; jokers « * » et « $ ». */
export function parseRobots(txt, agent = AGENT) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(txt || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") { if (val) cur.rules.push({ allow: key === "allow", path: val }); }
    else if (key === "crawl-delay" && Number.isFinite(Number(val))) cur.delay = Number(val) * 1000;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen.map((g) => g.delay).filter((d) => d != null);
  const toRe = (p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  const compiled = rules.map((r) => ({ ...r, re: toRe(r.path), len: r.path.length }));
  return {
    allowed(path) {
      let best = null;
      for (const r of compiled) {
        if (!r.re.test(path)) continue;
        if (!best || r.len > best.len || (r.len === best.len && r.allow)) best = r;
      }
      return !best || best.allow;
    },
    crawlDelayMs: delays.length ? Math.max(...delays) : 0,
  };
}

/* Liens sortants du corps d'un article (hors zones de navigation) :
   [{ href, domain }] en http(s), vers un autre site que l'article. */
export function outboundLinks(html, articleUrl) {
  const $ = cheerio.load(html);
  const own = domainOf(articleUrl);
  const out = [];
  const seen = new Set();
  $("a[href]").filter((_, el) => $(el).closest(NAV_ZONES).length === 0).each((_, el) => {
    let abs;
    try { abs = new URL($(el).attr("href"), articleUrl); } catch { return; }
    if (!/^https?:$/.test(abs.protocol)) return;
    const domain = registrableDomain(abs.hostname);
    const href = abs.toString().replace(/#.*$/, "");
    if (!domain || domain === own || seen.has(href)) return;
    seen.add(href);
    out.push({ href, domain });
  });
  return out;
}

/* Domaines candidats tirés des articles lus :
   articles [{ url, title, publishedAt, links: [{ href, domain }] }] →
   [{ domain, occurrences, articles: [{ url, title }], lastSeenAt }], les plus cités
   d'abord. Écartés : le concurrent, le référentiel (`known`, voir referenceDomains),
   IGNORED_DOMAINS et `exclude`. `occurrences` compte les liens distincts vers le
   domaine ; `lastSeenAt` : date de l'article le plus récent qui le cite (à défaut
   `now`). */
export function candidateDomains(articles, { competitorUrl, known = [], exclude = [], now = new Date().toISOString() } = {}) {
  const skip = referenceDomains(known);
  for (const d of [domainOf(competitorUrl), ...exclude.map(domainOf), ...IGNORED_DOMAINS]) if (d) skip.add(d);
  const byDomain = new Map();
  for (const a of articles) {
    const at = a.publishedAt || now;
    for (const { domain } of a.links || []) {
      if (skip.has(domain)) continue;
      let c = byDomain.get(domain);
      if (!c) byDomain.set(domain, (c = { domain, occurrences: 0, articles: [], lastSeenAt: at }));
      c.occurrences++;
      if (!c.articles.some((x) => x.url === a.url)) c.articles.push({ url: a.url, title: a.title || "" });
      if (at > c.lastSeenAt) c.lastSeenAt = at;
    }
  }
  return [...byDomain.values()].sort((x, y) => y.articles.length - x.articles.length || y.occurrences - x.occurrences || x.domain.localeCompare(y.domain));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const parser = new Parser();

/* Corps HTML d'un item de flux s'il porte des liens (content:encoded, ou
   description en HTML) ; "" sinon : il faudra lire la page d'article. */
function itemHtml(item) {
  const html = item["content:encoded"] || item.content || item.description || "";
  return /<a\s[^>]*href=/i.test(html) ? html : "";
}

/* Items d'un flux RSS/Atom (parties pures de fetchFeed.js : rss-parser, repairFeedXml) ; [] si illisible. */
async function feedItems(xml) {
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) return [];
  try { return (await parser.parseString(xml)).items || []; } catch { /* XML abîmé : on répare */ }
  try { return (await parser.parseString(repairFeedXml(xml))).items || []; } catch { return []; }
}

/* URL d'articles récents d'un sitemap, plus récentes d'abord : même filtre que recentFromSitemap. */
function sitemapArticles(entries, pageUrl, cutoffMs) {
  return entries
    .filter((e) => e.lastmod >= cutoffMs && newsPath(e.loc) && (scoreLink(e.loc, slugText(e.loc), pageUrl) ?? 0) >= 3)
    .sort((a, b) => b.lastmod - a.lastmod)
    .map((e) => e.loc);
}

/* Articles récents d'un concurrent, par trois voies dans l'ordre, la première qui
   en donne l'emporte (`via`) :
   1. « page » : sa page liste (ou d'accueil) et les liens d'articles qu'elle porte ;
   2. « flux » : flux RSS/Atom annoncés par la page (feedLinksIn), puis chemins
      courants (COMMON_PATHS de discoverFeeds) ; les liens sortants viennent du
      contenu de l'item s'il en porte, sinon de la page d'article ;
   3. « sitemap » : lignes Sitemap: du robots.txt, puis /sitemap.xml ; index suivi
      sur au plus quatre sous-sitemaps ; articles modifiés depuis `sinceDays`.
   Chaque requête passe par le robots.txt de son hôte, attend le délai et compte : au plus `maxArticles` pages d'article en tout, et `maxProbes`
   requêtes de recherche pour le flux, autant pour le sitemap. Une URL interdite
   n'est jamais demandée, sur aucune voie. Page du concurrent interdite : on passe
   au flux par les chemins courants, puis au sitemap, chaque URL restant contrôlée
   (un « Disallow: / » sans Allow ne laisse donc rien lire).
   Même site = même domaine enregistrable (www, apex et sous-domaines du
   concurrent), chaque hôte sous son propre robots.txt (voir readRobots) ; un
   autre site est refusé. robots.txt du concurrent injoignable : rien n'est lu.
   → { via: "page"|"flux"|"sitemap"|null, articles: [{ url, title, publishedAt, links }],
       skipped: [{ url, reason }], hosts: [origines dont le robots.txt a été lu], error? }
   `fetcher(url, { timeoutMs })` : fetchCapped par défaut (injection pour les tests). */
export async function crawlCompetitor(competitorUrl, { fetcher = fetchCapped, maxArticles = 10, maxProbes = 8, maxHosts = 4, delayMs = 1000, timeoutMs = 15000, sinceDays = 30, sleep = wait, now = Date.now() } = {}) {
  const skipped = [];
  let base;
  try { base = new URL(competitorUrl); } catch { return { via: null, articles: [], skipped, error: "URL invalide" }; }

  /* robots.txt par hôte (T10) : toute URL du même domaine enregistrable que le
     concurrent (www, apex, sous-domaines) est acceptée, sous le robots.txt de SON
     origine, lu une fois et gardé pour le crawl. Au plus `maxHosts` robots.txt lus,
     celui du concurrent compris ; au-delà, l'hôte est refusé. 4xx : tout permis ;
     réseau ou 5xx : rien sur cet hôte, le reste continue. Le délai entre requêtes
     est le plus long Crawl-delay rencontré (plafonné à 30 s), au moins delayMs. */
  const site = domainOf(competitorUrl);
  const hosts = new Map(); // origine → { robots, txt } | { down: raison }
  let gap = delayMs;
  const readRobots = async (origin, { first = false } = {}) => {
    if (hosts.has(origin)) return hosts.get(origin);
    if (hosts.size >= maxHosts) return { down: "hôtes bornés" };
    if (!first) await sleep(gap);
    let entry;
    try {
      const txt = await fetcher(`${origin}/robots.txt`, { timeoutMs });
      entry = { robots: parseRobots(txt, AGENT), txt: String(txt) };
    } catch (err) {
      entry = /^HTTP 4\d\d$/.test(err.message || "") ? { robots: parseRobots(""), txt: "" } : { down: `robots.txt injoignable : ${err.message || err}` };
    }
    if (entry.robots) gap = Math.max(gap, Math.min(entry.robots.crawlDelayMs, 30_000));
    hosts.set(origin, entry);
    return entry;
  };
  const done = (r) => ({ ...r, skipped, hosts: [...hosts.keys()] });

  const main = await readRobots(base.origin, { first: true });
  if (main.down) return done({ via: null, articles: [], error: main.down });
  const robotsTxt = main.txt;

  /* Raison de ne pas demander `url`, ou null : autre site, hôte en trop ou
     injoignable, ou interdite par le robots.txt de son hôte. */
  const refusal = async (url) => {
    let u;
    try { u = new URL(url); } catch { return "URL invalide"; }
    if (!/^https?:$/.test(u.protocol) || registrableDomain(u.hostname) !== site) return "autre site";
    const h = await readRobots(u.origin);
    if (h.down) return h.down;
    return h.robots.allowed(u.pathname + u.search) ? null : "robots";
  };

  /* Toute requête après robots.txt passe ici : refusal, délai, puis le fetcher.
     null si refusée (notée dans skipped) ; throw si la requête échoue. */
  const get = async (url) => {
    const why = await refusal(url);
    if (why) { skipped.push({ url, reason: why }); return null; }
    await sleep(gap);
    return fetcher(url, { timeoutMs });
  };
  /* Recherche de flux et de sitemap : au plus maxProbes requêtes ; une URL refusée ne compte pas. */
  let probes = 0;
  const probe = async (url) => {
    if (probes >= maxProbes) return null;
    const why = await refusal(url);
    if (why) { skipped.push({ url, reason: why }); return null; }
    probes++;
    try { return await get(url); } catch (err) { skipped.push({ url, reason: err.message || String(err) }); return null; }
  };

  /* Pages d'article, au plus maxArticles demandées sur l'ensemble du crawl (échecs
     compris) : des échecs en série ne font pas lire tout le site. */
  let fetched = 0;
  const readArticles = async (urls) => {
    const articles = [];
    for (const url of urls) {
      if (fetched >= maxArticles) break;
      const why = await refusal(url);
      if (why) { skipped.push({ url, reason: why }); continue; }
      fetched++;
      try {
        const page = await get(url);
        const { title, publishedAt, blocked } = parseArticleHtml(page);
        if (blocked) { skipped.push({ url, reason: "bloquée" }); continue; }
        articles.push({ url, title, publishedAt, links: outboundLinks(page, url) });
      } catch (err) {
        skipped.push({ url, reason: err.message || String(err) });
      }
    }
    return articles;
  };

  /* 1. Page liste ou d'accueil. Interdite, en erreur ou sans article lisible : on
     passe au flux (un « Allow: /rss » sous un « Disallow: / » l'autorise). */
  const pageBarred = (await refusal(competitorUrl)) === "robots";
  let html = null;
  try { html = await get(competitorUrl); } catch (err) { skipped.push({ url: competitorUrl, reason: err.message || String(err) }); }
  if (html) {
    const articles = await readArticles(listLinks(html, competitorUrl));
    if (articles.length) return done({ via: "page", articles });
  }

  /* 2. Flux RSS/Atom. Les items qui portent leurs liens ne coûtent aucune requête. */
  const feeds = [...new Set([...(html ? feedLinksIn(html, competitorUrl) : []), ...COMMON_PATHS.map((p) => base.origin + p)])];
  for (const feedUrl of feeds) {
    const xml = await probe(feedUrl);
    const items = xml ? (await feedItems(xml)).filter((it) => it.link) : [];
    if (!items.length) continue;
    const articles = [];
    const toRead = [];
    for (const it of items.slice(0, maxArticles)) {
      let url;
      try { url = new URL(it.link, feedUrl).toString(); } catch { continue; }
      const entry = { url, title: it.title || "", publishedAt: it.isoDate || null };
      const body = itemHtml(it);
      if (body) articles.push({ ...entry, links: outboundLinks(body, url) });
      else toRead.push(entry);
    }
    for (const a of await readArticles(toRead.map((t) => t.url))) {
      const t = toRead.find((x) => x.url === a.url);
      articles.push({ ...a, title: a.title || t.title, publishedAt: a.publishedAt || t.publishedAt });
    }
    if (articles.length) return done({ via: "flux", articles });
  }

  /* 3. Sitemap, avec son propre budget de recherche. */
  probes = 0;
  const declared = [...String(robotsTxt).matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const cutoffMs = now - sinceDays * 86400000;
  for (const root of [...new Set([...declared, base.origin + "/sitemap.xml"])]) {
    const xml = await probe(root);
    if (!xml || !/<(urlset|sitemapindex)[\s>]/i.test(xml)) continue;
    let { isIndex, entries } = parseSitemap(xml);
    if (isIndex) {
      /* Au plus quatre sous-sitemaps, comme recentFromSitemap. */
      const children = entries.sort((a, b) => (CHILD_HINT.test(b.loc) - CHILD_HINT.test(a.loc)) || b.lastmod - a.lastmod).slice(0, 4);
      entries = [];
      for (const c of children) {
        const sub = await probe(c.loc);
        if (sub) entries.push(...parseSitemap(sub).entries);
      }
    }
    const articles = await readArticles(sitemapArticles(entries, competitorUrl, cutoffMs));
    if (articles.length) return done({ via: "sitemap", articles });
  }

  return done({ via: null, articles: [], error: pageBarred
    ? "robots.txt interdit la page, et ni flux ni sitemap autorisé n'a donné d'article"
    : "aucun article par la page, le flux ni le sitemap" });
}

/* Crawl d'un concurrent puis domaines candidats (voir crawlCompetitor et candidateDomains). */
export async function competitorCandidates(competitorUrl, { known = [], exclude = [], ...crawl } = {}) {
  const r = await crawlCompetitor(competitorUrl, crawl);
  return { ...r, candidates: candidateDomains(r.articles, { competitorUrl, known, exclude }) };
}
