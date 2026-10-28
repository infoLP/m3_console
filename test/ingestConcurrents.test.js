/* M3-121 — concurrents, partie récolte (src/ingest/concurrents.js) : domaines
   candidats tirés des articles d'un concurrent, robots.txt et volume borné.
   Réseau simulé par un `fetcher` injecté. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  registrableDomain, domainOf, referenceDomains, parseRobots, outboundLinks,
  candidateDomains, crawlCompetitor, competitorCandidates,
} from "../src/ingest/concurrents.js";

const SITE = "https://www.concurrent.fr";
const LIST = `${SITE}/actualites`;

const article = (body, { title = "Un titre d'article assez long pour passer", date = "2026-10-20T08:00:00Z" } = {}) =>
  `<html><head><title>${title}</title><meta property="article:published_time" content="${date}"></head>` +
  `<body><header><a href="https://partenaire-du-bandeau.fr/">bandeau</a></header>` +
  `<article><h1>${title}</h1><p>${"Texte de l'article. ".repeat(20)}</p>${body}</article>` +
  `<footer><a href="https://facebook.com/concurrent">fb</a></footer></body></html>`;

/* Page liste : n liens d'articles du même site, au slug de titre. */
const listPage = (n) => `<html><body><main>${Array.from({ length: n }, (_, i) =>
  `<a href="/actualites/2026/10/un-article-numero-${i + 1}-sur-le-sujet">Un article numéro ${i + 1} sur le sujet du jour</a>`).join("")}</main></body></html>`;

/* Réseau simulé : url → texte, ou nombre (statut HTTP d'erreur). `calls` garde les URL demandées. */
function net(pages) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const v = pages[url];
    if (v === undefined) throw new Error("HTTP 404");
    if (typeof v === "number") throw new Error(`HTTP ${v}`);
    return v;
  };
  return { fetcher, calls };
}
const noSleep = async () => {};

test("domaines normalisés : www, sous-domaines, schéma ; suffixes publics gardés", () => {
  assert.equal(domainOf("https://www.exemple.fr/a"), "exemple.fr");
  assert.equal(domainOf("http://presse.exemple.fr/"), "exemple.fr");
  assert.equal(domainOf("exemple.fr"), "exemple.fr");
  assert.equal(domainOf("https://www.prefecture.gouv.fr/x"), "prefecture.gouv.fr");
  assert.equal(domainOf("https://www.charente-maritime.gouv.fr/"), "charente-maritime.gouv.fr");
  assert.equal(registrableDomain("127.0.0.1"), "");
  assert.equal(domainOf("mailto:a@b.fr"), "");
  assert.deepEqual([...referenceDomains(["www.a.fr", { rssUrl: "https://flux.b.fr/rss", name: "B" }])].sort(), ["a.fr", "b.fr"]);
});

test("critère 1 : un article qui cite un domaine inconnu le fait apparaître ; un domaine du référentiel non", () => {
  const url = `${LIST}/2026/10/un-article`;
  const html = article(`<a href="https://www.inconnu.fr/communique">source</a> <a href="https://deja-connu.fr/x">connue</a>`);
  const articles = [{ url, title: "Titre", publishedAt: "2026-10-20T08:00:00.000Z", links: outboundLinks(html, url) }];
  const c = candidateDomains(articles, { competitorUrl: SITE, known: [{ siteUrl: "https://www.deja-connu.fr/" }] });
  assert.deepEqual(c.map((x) => x.domain), ["inconnu.fr"]);
  assert.deepEqual(c[0], { domain: "inconnu.fr", occurrences: 1, articles: [{ url, title: "Titre" }], lastSeenAt: "2026-10-20T08:00:00.000Z" });
});

test("critère 2 : réseaux sociaux, concurrent lui-même, liens internes, CDN et partages ignorés ; sous-domaines repliés", () => {
  const url = `${LIST}/2026/10/un-article`;
  const html = article([
    `<a href="/autre-article">interne relatif</a>`,
    `<a href="https://www.concurrent.fr/rubrique">interne absolu</a>`,
    `<a href="https://blog.concurrent.fr/billet">sous-domaine du concurrent</a>`,
    `<a href="https://www.facebook.com/sharer.php?u=x">partage</a>`,
    `<a href="https://x.com/compte">x</a>`,
    `<a href="https://fr.linkedin.com/company/y">linkedin</a>`,
    `<a href="https://static.addtoany.com/menu">addtoany</a>`,
    `<a href="https://cdn.jsdelivr.net/lib.js">cdn</a>`,
    `<a href="mailto:contact@inconnu.fr">mail</a>`,
    `<a href="https://presse.organisme.fr/cp-1">cp 1</a>`,
    `<a href="https://www.organisme.fr/cp-2">cp 2</a>`,
  ].join(" "));
  const links = outboundLinks(html, url);
  assert.ok(!links.some((l) => l.domain === "partenaire-du-bandeau.fr"), "liens du bandeau (navigation) ignorés");
  const c = candidateDomains([{ url, title: "T", links }], { competitorUrl: LIST });
  assert.deepEqual(c.map((x) => [x.domain, x.occurrences, x.articles.length]), [["organisme.fr", 2, 1]]);
});

test("candidats : plusieurs articles → occurrences cumulées, dernière occurrence, plus cités d'abord ; `exclude` respecté", () => {
  const a = (url, publishedAt, ...domains) => ({ url, title: url, publishedAt, links: domains.map((d, i) => ({ href: `https://${d}/${i}`, domain: d })) });
  const c = candidateDomains([
    a("u1", "2026-10-01T00:00:00.000Z", "x.fr", "y.fr", "z.fr"),
    a("u2", "2026-10-15T00:00:00.000Z", "x.fr"),
  ], { competitorUrl: SITE, exclude: ["https://z.fr"] });
  assert.deepEqual(c.map((x) => [x.domain, x.occurrences, x.articles.map((r) => r.url), x.lastSeenAt]), [
    ["x.fr", 2, ["u1", "u2"], "2026-10-15T00:00:00.000Z"],
    ["y.fr", 1, ["u1"], "2026-10-01T00:00:00.000Z"],
  ]);
});

test("robots.txt : groupe de notre agent prioritaire, règle la plus longue, Allow à égalité, jokers, Crawl-delay", () => {
  const r = parseRobots([
    "User-agent: *", "Disallow: /", "",
    "User-agent: M3-prototype", "Disallow: /prive", "Allow: /prive/public", "Disallow: /*.pdf$", "Crawl-delay: 2",
  ].join("\n"));
  assert.equal(r.allowed("/actualites"), true, "notre groupe remplace celui de *");
  assert.equal(r.allowed("/prive/x"), false);
  assert.equal(r.allowed("/prive/public/y"), true);
  assert.equal(r.allowed("/doc.pdf"), false);
  assert.equal(r.allowed("/doc.pdf?v=1"), true);
  assert.equal(r.crawlDelayMs, 2000);
  assert.equal(parseRobots("User-agent: *\nDisallow:").allowed("/x"), true, "Disallow vide : tout permis");
});

test("critère 3 : robots.txt interdisant le chemin → aucune page de ce chemin lue", async () => {
  const { fetcher, calls } = net({
    [`${SITE}/robots.txt`]: "User-agent: *\nDisallow: /actualites",
    [LIST]: listPage(3),
  });
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep });
  assert.deepEqual(calls.filter((u) => u.startsWith(`${SITE}/actualites`)), [], "ni la page ni rien sous /actualites");
  assert.deepEqual(r.articles, []);
  assert.match(r.error, /robots/);
});

test("critère 3 : articles interdits par robots.txt sautés sans être demandés", async () => {
  const pages = { [`${SITE}/robots.txt`]: "User-agent: *\nDisallow: /actualites/2026/10/un-article-numero-1-", [LIST]: listPage(2) };
  pages[`${LIST}/2026/10/un-article-numero-2-sur-le-sujet`] = article(`<a href="https://inconnu.fr/">x</a>`);
  const { fetcher, calls } = net(pages);
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep });
  assert.ok(!calls.some((u) => u.includes("numero-1-")), "article interdit jamais demandé");
  assert.deepEqual(r.skipped.map((s) => s.reason), ["robots"]);
  assert.equal(r.articles.length, 1);
});

test("critère 3 : volume borné — au plus maxArticles pages d'article, espacées du délai (Crawl-delay s'il est plus long)", async () => {
  const pages = { [`${SITE}/robots.txt`]: "User-agent: *\nCrawl-delay: 3", [LIST]: listPage(12) };
  for (let i = 1; i <= 12; i++) pages[`${LIST}/2026/10/un-article-numero-${i}-sur-le-sujet`] = i % 2 ? 503 : article("");
  const { fetcher, calls } = net(pages);
  const waits = [];
  const r = await crawlCompetitor(LIST, { fetcher, maxArticles: 4, delayMs: 500, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(calls.length, 2 + 4, "robots.txt, la liste, puis 4 articles — échecs compris");
  assert.deepEqual(waits, [3000, 3000, 3000, 3000, 3000], "page liste comprise");
  assert.equal(r.articles.length, 2);
  assert.equal(r.skipped.length, 2);
});

test("robots.txt absent (404) : tout permis ; injoignable (503) : rien n'est lu", async () => {
  const absent = net({ [LIST]: listPage(1), [`${LIST}/2026/10/un-article-numero-1-sur-le-sujet`]: article("") });
  assert.equal((await crawlCompetitor(LIST, { fetcher: absent.fetcher, sleep: noSleep })).articles.length, 1);
  const down = net({ [`${SITE}/robots.txt`]: 503, [LIST]: listPage(1) });
  const r = await crawlCompetitor(LIST, { fetcher: down.fetcher, sleep: noSleep });
  assert.deepEqual(down.calls, [`${SITE}/robots.txt`]);
  assert.match(r.error, /robots\.txt injoignable/);
});

test("de bout en bout : concurrent → domaines candidats hors référentiel", async () => {
  const pages = { [`${SITE}/robots.txt`]: "", [LIST]: listPage(2) };
  pages[`${LIST}/2026/10/un-article-numero-1-sur-le-sujet`] = article(`<a href="https://www.mairie-exemple.fr/arrete">arrêté</a> <a href="https://connu.fr/">c</a>`, { date: "2026-10-10T00:00:00Z" });
  pages[`${LIST}/2026/10/un-article-numero-2-sur-le-sujet`] = article(`<a href="https://mairie-exemple.fr/cp">cp</a>`, { date: "2026-10-12T00:00:00Z" });
  const { fetcher } = net(pages);
  const r = await competitorCandidates(LIST, { fetcher, sleep: noSleep, known: ["connu.fr"] });
  assert.deepEqual(r.candidates.map((c) => [c.domain, c.occurrences, c.articles.length, c.lastSeenAt]),
    [["mairie-exemple.fr", 2, 2, "2026-10-12T00:00:00.000Z"]]);
});

/* T9 — repli flux RSS puis sitemap quand la page liste ne donne pas d'article. */
const EMPTY_LIST = `<html><head><link rel="alternate" type="application/rss+xml" href="/rss/actus.xml"></head><body><main>rendu en JavaScript</main></body></html>`;
const rss = (items) => `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Concurrent</title>${items.join("")}</channel></rss>`;
const rssItem = (n, html) => `<item><title>Article ${n} du flux</title><link>${SITE}/actu/article-${n}</link><pubDate>Mon, 2${n} Oct 2026 08:00:00 GMT</pubDate>` +
  (html ? `<content:encoded><![CDATA[${html}]]></content:encoded>` : `<description>Résumé sans lien</description>`) + `</item>`;
const DAY = 86400000;
const NOW = Date.parse("2026-10-27T12:00:00Z");
const urlset = (locs) => `<?xml version="1.0"?><urlset>${locs.map(([loc, lm]) => `<url><loc>${loc}</loc><lastmod>${lm}</lastmod></url>`).join("")}</urlset>`;
const smArticle = (n) => `${SITE}/actualites/2026/10/un-communique-de-presse-numero-${n}`;

test("T9 critère 1 : page liste sans article → articles du flux annoncé ; liens tirés de content:encoded sans lire la page d'article", async () => {
  const { fetcher, calls } = net({
    [`${SITE}/robots.txt`]: "",
    [LIST]: EMPTY_LIST,
    [`${SITE}/rss/actus.xml`]: rss([
      rssItem(1, `<p>Selon <a href="https://www.prefecture.gouv.fr/arrete">l'arrêté</a></p>`),
      rssItem(2, `<p><a href="https://inconnu.fr/cp">communiqué</a> <a href="https://x.com/compte">x</a></p>`),
    ]),
  });
  const r = await competitorCandidates(LIST, { fetcher, sleep: noSleep });
  assert.equal(r.via, "flux");
  assert.deepEqual(calls, [`${SITE}/robots.txt`, LIST, `${SITE}/rss/actus.xml`], "aucune page d'article demandée");
  assert.deepEqual(r.articles.map((a) => [a.url, a.title]), [[`${SITE}/actu/article-1`, "Article 1 du flux"], [`${SITE}/actu/article-2`, "Article 2 du flux"]]);
  assert.deepEqual(r.candidates.map((c) => c.domain).sort(), ["inconnu.fr", "prefecture.gouv.fr"]);
});

test("T9 : item de flux sans lien dans son contenu → page d'article lue (si robots l'autorise), titre et date du flux en secours", async () => {
  const { fetcher, calls } = net({
    [`${SITE}/robots.txt`]: "",
    [LIST]: 404,
    [`${SITE}/feed`]: rss([rssItem(1, "")]),
    [`${SITE}/actu/article-1`]: `<html><body><article><p>${"Texte. ".repeat(40)}<a href="https://organisme.fr/x">source</a></p></article></body></html>`,
  });
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep });
  assert.equal(r.via, "flux");
  assert.ok(calls.includes(`${SITE}/actu/article-1`));
  assert.deepEqual(r.articles[0].links.map((l) => l.domain), ["organisme.fr"]);
  assert.equal(r.articles[0].publishedAt, "2026-10-21T08:00:00.000Z");
});

test("T9 critère 2 : ni page ni flux → sitemap déclaré par robots.txt ; via « sitemap »", async () => {
  const pages = {
    [`${SITE}/robots.txt`]: `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemaps/news.xml`,
    [LIST]: EMPTY_LIST,
    [`${SITE}/sitemaps/news.xml`]: urlset([
      [smArticle(1), "2026-10-25"],
      [smArticle(2), "2026-10-20"],
      [smArticle(3), "2026-08-01"],                 // trop ancien
      [`${SITE}/mentions-legales`, "2026-10-26"],   // pas un article
    ]),
  };
  pages[smArticle(1)] = article(`<a href="https://www.mairie-exemple.fr/a">a</a>`);
  pages[smArticle(2)] = article(`<a href="https://mairie-exemple.fr/b">b</a>`);
  const { fetcher, calls } = net(pages);
  const r = await competitorCandidates(LIST, { fetcher, sleep: noSleep, now: NOW });
  assert.equal(r.via, "sitemap");
  assert.deepEqual(r.articles.map((a) => a.url), [smArticle(1), smArticle(2)], "plus récents d'abord, ancien et utilitaire écartés");
  assert.ok(!calls.includes(smArticle(3)));
  assert.deepEqual(r.candidates.map((c) => [c.domain, c.articles.length]), [["mairie-exemple.fr", 2]]);
});

test("T9 : index de sitemap → sous-sitemaps d'actualités suivis ; sitemap d'un autre site ignoré", async () => {
  const pages = {
    [`${SITE}/robots.txt`]: `Sitemap: https://cdn.ailleurs.fr/sitemap.xml`,
    [LIST]: 404,
    [`${SITE}/sitemap.xml`]: `<sitemapindex><sitemap><loc>${SITE}/sitemap-pages.xml</loc></sitemap><sitemap><loc>${SITE}/sitemap-actualites.xml</loc><lastmod>2026-10-26</lastmod></sitemap></sitemapindex>`,
    [`${SITE}/sitemap-actualites.xml`]: urlset([[smArticle(1), "2026-10-26"]]),
    [`${SITE}/sitemap-pages.xml`]: urlset([]),
  };
  pages[smArticle(1)] = article("");
  const { fetcher, calls } = net(pages);
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep, now: NOW });
  assert.equal(r.via, "sitemap");
  assert.ok(!calls.some((u) => u.startsWith("https://cdn.ailleurs.fr")), "pas de requête hors du site");
  assert.ok(r.skipped.some((s) => s.reason === "autre site"));
});

test("T9 critère 3 : robots.txt interdisant le flux et le sitemap → ni l'un ni l'autre demandé", async () => {
  const { fetcher, calls } = net({
    [`${SITE}/robots.txt`]: `User-agent: *\nDisallow: /rss/\nDisallow: /feed\nDisallow: /sitemap\nSitemap: ${SITE}/sitemap.xml`,
    [LIST]: EMPTY_LIST,
    [`${SITE}/rss/actus.xml`]: rss([rssItem(1, `<a href="https://inconnu.fr/">x</a>`)]),
    [`${SITE}/feed`]: rss([rssItem(1, `<a href="https://inconnu.fr/">x</a>`)]),
    [`${SITE}/sitemap.xml`]: urlset([[smArticle(1), "2026-10-26"]]),
  });
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep, now: NOW });
  const forbidden = [`${SITE}/rss/actus.xml`, `${SITE}/feed`, `${SITE}/feed/`, `${SITE}/feed.xml`, `${SITE}/sitemap.xml`];
  assert.deepEqual(calls.filter((u) => forbidden.includes(u)), [], `demandés : ${calls.join(", ")}`);
  assert.ok(calls.includes(`${SITE}/actualites/feed`), "un chemin de flux que robots.txt autorise reste essayé");
  assert.ok(r.skipped.filter((s) => s.reason === "robots").length >= 3);
  assert.equal(r.via, null);
  assert.deepEqual(r.articles, []);
});

test("T9 critère 3 : robots.txt qui interdit tout à « * » et déclare ses sitemaps → seul robots.txt est lu", async () => {
  const { fetcher, calls } = net({
    [`${SITE}/robots.txt`]: `User-agent: *\nDisallow: /\nSitemap: ${SITE}/sitemap.xml\nSitemap: ${SITE}/googlenews.xml`,
    [LIST]: listPage(3),
  });
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep });
  assert.deepEqual(calls, [`${SITE}/robots.txt`]);
  assert.match(r.error, /robots/);
});

test("T9 critère 3 : maxArticles et délai respectés par le flux et par le sitemap", async () => {
  const items = Array.from({ length: 9 }, (_, i) => rssItem(i + 1, ""));
  const pages = { [`${SITE}/robots.txt`]: "User-agent: *\nCrawl-delay: 2", [LIST]: EMPTY_LIST, [`${SITE}/rss/actus.xml`]: rss(items) };
  for (let i = 1; i <= 9; i++) pages[`${SITE}/actu/article-${i}`] = article("");
  const viaFeed = net(pages);
  const waits = [];
  const r = await crawlCompetitor(LIST, { fetcher: viaFeed.fetcher, maxArticles: 3, delayMs: 100, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(r.via, "flux");
  assert.equal(viaFeed.calls.filter((u) => u.includes("/actu/")).length, 3);
  assert.equal(waits.length, viaFeed.calls.length - 1, "un délai avant chaque requête après robots.txt");
  assert.ok(waits.every((w) => w === 2000));

  const sm = { [`${SITE}/robots.txt`]: "", [LIST]: 404, [`${SITE}/sitemap.xml`]: urlset(Array.from({ length: 9 }, (_, i) => [smArticle(i + 1), "2026-10-26"])) };
  for (let i = 1; i <= 9; i++) sm[smArticle(i)] = article("");
  const viaSitemap = net(sm);
  const waits2 = [];
  const r2 = await crawlCompetitor(LIST, { fetcher: viaSitemap.fetcher, maxArticles: 2, maxProbes: 3, now: NOW, sleep: async (ms) => { waits2.push(ms); } });
  assert.equal(r2.via, "sitemap");
  assert.equal(viaSitemap.calls.filter((u) => u.includes("communique")).length, 2);
  assert.ok(viaSitemap.calls.filter((u) => /feed|rss|backend/.test(u)).length <= 3, "recherche de flux bornée par maxProbes");
  assert.equal(waits2.length, viaSitemap.calls.length - 1);
});

test("revue T9 : item de flux d'un autre site, à lire → jamais demandé ; ses liens portés par le contenu restent gardés", async () => {
  const other = (n, html) => rssItem(n, html).replace(`${SITE}/actu/article-${n}`, `https://feeds.feedburner.com/concurrent/article-${n}`);
  const { fetcher, calls } = net({
    [`${SITE}/robots.txt`]: "",
    [LIST]: EMPTY_LIST,
    [`${SITE}/rss/actus.xml`]: rss([other(1, ""), other(2, `<a href="https://inconnu.fr/">x</a>`), rssItem(4, "")]),
    [`${SITE}/actu/article-4`]: article(`<a href="https://organisme.fr/">o</a>`),
  });
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep });
  assert.equal(r.via, "flux");
  assert.ok(!calls.some((u) => /feedburner/.test(u)), `demandés : ${calls.join(", ")}`);
  assert.deepEqual(r.skipped.filter((s) => s.reason === "autre site").map((s) => s.url), ["https://feeds.feedburner.com/concurrent/article-1"]);
  assert.deepEqual(r.articles.map((a) => a.url).sort(), ["https://feeds.feedburner.com/concurrent/article-2", `${SITE}/actu/article-4`],
    "item d'un autre site dont le contenu porte les liens : gardé, sans requête");
});

test("revue T9 : page interdite mais « Allow: /rss » sous « Disallow: / » → le flux est lu, la page non", async () => {
  const { fetcher, calls } = net({
    [`${SITE}/robots.txt`]: "User-agent: *\nDisallow: /\nAllow: /rss",
    [LIST]: listPage(3),
    [`${SITE}/rss`]: rss([rssItem(1, `<a href="https://inconnu.fr/">x</a>`)]),
  });
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep });
  assert.ok(!calls.includes(LIST), "la page interdite n'est pas demandée");
  assert.ok(calls.every((u) => u === `${SITE}/robots.txt` || u.startsWith(`${SITE}/rss`)), `demandés : ${calls.join(", ")}`);
  assert.equal(r.via, "flux");
  assert.deepEqual(r.articles.map((a) => a.url), [`${SITE}/actu/article-1`]);
});

test("revue T9 : page interdite, flux interdits, sitemap autorisé → sitemap", async () => {
  const pages = {
    [`${SITE}/robots.txt`]: "User-agent: *\nDisallow: /\nAllow: /sitemap.xml\nAllow: /actualites/2026/",
    [LIST]: listPage(3),
    [`${SITE}/sitemap.xml`]: urlset([[smArticle(1), "2026-10-26"]]),
  };
  pages[smArticle(1)] = article(`<a href="https://inconnu.fr/">x</a>`);
  const { fetcher, calls } = net(pages);
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep, now: NOW });
  assert.deepEqual(calls, [`${SITE}/robots.txt`, `${SITE}/sitemap.xml`, smArticle(1)]);
  assert.equal(r.via, "sitemap");
});

/* T10 — un robots.txt par hôte du même site (www, apex, sous-domaines). */
const APEX = "https://concurrent.fr";
const slug = (host, n) => `${host}/actualites/2026/10/un-article-numero-${n}-sur-le-sujet`;
/* Page liste dont les liens d'articles sont absolus, vers les hôtes donnés. */
const listOn = (urls) => `<html><body><main>${urls.map((u, i) => `<a href="${u}">Un article numéro ${i + 1} sur le sujet du jour</a>`).join("")}</main></body></html>`;

test("T10 critère 1 : concurrent saisi sans www, articles en www → lus ; robots.txt de www lu une seule fois", async () => {
  const urls = [slug(SITE, 1), slug(SITE, 2), slug(SITE, 3)];
  const pages = { [`${APEX}/robots.txt`]: "", [`${APEX}/actualites`]: listOn(urls), [`${SITE}/robots.txt`]: "User-agent: *\nCrawl-delay: 2" };
  for (const u of urls) pages[u] = article(`<a href="https://inconnu.fr/">x</a>`);
  const { fetcher, calls } = net(pages);
  const waits = [];
  const r = await crawlCompetitor(`${APEX}/actualites`, { fetcher, delayMs: 100, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(r.via, "page");
  assert.deepEqual(r.articles.map((a) => a.url), urls);
  assert.equal(calls.filter((u) => u === `${SITE}/robots.txt`).length, 1, "robots.txt de www lu une fois");
  assert.deepEqual(r.hosts, [APEX, SITE]);
  assert.deepEqual(waits.slice(-3), [2000, 2000, 2000], "le Crawl-delay de www, plus long, s'applique ensuite");
});

test("T10 critère 2 : sous-domaine dont le robots.txt interdit le chemin → non demandé, l'hôte principal l'autorise", async () => {
  const BLOG = "https://blog.concurrent.fr";
  const urls = [slug(BLOG, 1), slug(SITE, 2), slug(BLOG, 3)];
  const pages = {
    [`${SITE}/robots.txt`]: "User-agent: *\nAllow: /",
    [LIST]: listOn(urls),
    [`${BLOG}/robots.txt`]: "User-agent: *\nDisallow: /actualites/",
  };
  for (const u of urls) pages[u] = article("");
  const { fetcher, calls } = net(pages);
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep });
  assert.ok(!calls.some((u) => u.startsWith(`${BLOG}/actualites`)), `demandés : ${calls.join(", ")}`);
  assert.deepEqual(r.skipped.map((s) => [s.url, s.reason]), [[slug(BLOG, 1), "robots"], [slug(BLOG, 3), "robots"]]);
  assert.equal(calls.filter((u) => u === `${BLOG}/robots.txt`).length, 1);
  assert.deepEqual(r.articles.map((a) => a.url), [slug(SITE, 2)]);
});

test("T10 critère 3 : autre site refusé ; robots.txt d'un hôte en 503 → rien sur cet hôte, le reste continue", async () => {
  const DOWN = "https://presse.concurrent.fr";
  const pages = {
    [`${SITE}/robots.txt`]: "",
    [LIST]: EMPTY_LIST,
    [`${SITE}/rss/actus.xml`]: rss([
      rssItem(1, "").replace(`${SITE}/actu/article-1`, "https://www.autre-site.fr/actu/article-1"),
      rssItem(2, "").replace(`${SITE}/actu/article-2`, `${DOWN}/actu/article-2`),
      rssItem(3, ""),
    ]),
    [`${DOWN}/robots.txt`]: 503,
    [`${DOWN}/actu/article-2`]: article(""),
    [`${SITE}/actu/article-3`]: article(`<a href="https://inconnu.fr/">x</a>`),
  };
  const { fetcher, calls } = net(pages);
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep });
  assert.ok(!calls.some((u) => u.includes("autre-site.fr")), "autre site : pas même son robots.txt");
  assert.ok(!calls.includes(`${DOWN}/actu/article-2`), "hôte au robots.txt injoignable : rien lu");
  assert.deepEqual(r.skipped.map((s) => s.reason), ["autre site", "robots.txt injoignable : HTTP 503"]);
  assert.deepEqual(r.articles.map((a) => a.url), [`${SITE}/actu/article-3`], "le reste continue");
});

test("T10 critère 3 : nombre d'hôtes borné — au plus maxHosts robots.txt lus, concurrent compris", async () => {
  const subs = ["a", "b", "c", "d"].map((h) => `https://${h}.concurrent.fr`);
  const urls = subs.map((h, i) => slug(h, i + 1));
  const pages = { [`${SITE}/robots.txt`]: "", [LIST]: listOn(urls) };
  for (const h of subs) pages[`${h}/robots.txt`] = "";
  for (const u of urls) pages[u] = article("");
  const { fetcher, calls } = net(pages);
  const r = await crawlCompetitor(LIST, { fetcher, sleep: noSleep, maxHosts: 3 });
  assert.equal(calls.filter((u) => u.endsWith("/robots.txt")).length, 3);
  assert.deepEqual(r.hosts, [SITE, subs[0], subs[1]]);
  assert.deepEqual(r.articles.map((a) => a.url), urls.slice(0, 2));
  assert.deepEqual(r.skipped.map((s) => s.reason), ["hôtes bornés", "hôtes bornés"]);
});

/* T13 — seconds niveaux génériques sous un TLD de pays (« co.il » sorti candidat sur un vrai scan). */
test("T13 : co.il, com.tr… sont des suffixes publics ; un suffixe seul n'est jamais candidat", () => {
  assert.equal(domainOf("https://www.maariv.co.il/news/1"), "maariv.co.il");
  assert.equal(registrableDomain("maariv.co.il"), "maariv.co.il");
  assert.equal(registrableDomain("news.bbc.co.uk"), "bbc.co.uk");
  assert.equal(registrableDomain("www.x.com.au"), "x.com.au");
  assert.equal(registrableDomain("y.com.tr"), "y.com.tr");
  assert.equal(registrableDomain("portal.gob.mx"), "portal.gob.mx");
  assert.equal(registrableDomain("www.prefecture.gouv.fr"), "prefecture.gouv.fr");
  assert.equal(registrableDomain("presse.exemple.fr"), "exemple.fr");
  assert.equal(registrableDomain("blog.exemple.com"), "exemple.com", "TLD générique : inchangé");
  assert.equal(registrableDomain("www.co.com"), "co.com", "co sous un TLD à trois lettres : domaine ordinaire");
  assert.equal(registrableDomain("co.il"), "");
  assert.equal(registrableDomain("gouv.fr"), "");

  const url = `${LIST}/2026/10/un-article`;
  const html = article(`<a href="https://co.il/">suffixe</a> <a href="https://www.maariv.co.il/a">maariv</a> <a href="https://com.tr/x">suffixe</a>`);
  const c = candidateDomains([{ url, title: "T", publishedAt: "2026-10-20T08:00:00.000Z", links: outboundLinks(html, url) }], { competitorUrl: SITE });
  assert.deepEqual(c.map((x) => x.domain), ["maariv.co.il"]);
});
