/* M3-50 — fiabilité de la récolte (2026-10-14) : choix des liens d'une page
   liste, repli sitemap, rendement et score par source, découverte de flux. */

import test from "node:test";
import assert from "node:assert/strict";
import { scoreLink, pickArticleLinks, sameSite } from "../src/ingest/links.js";
import { listLinks } from "../src/ingest/fetchArticleList.js";
import { parseSitemap, slugText } from "../src/ingest/sitemap.js";
import { recordYield, reliabilityOf, MUTE_AFTER } from "../shared/sourceReliability.js";
import { feedLinksIn, jobShare } from "../src/ingest/discoverFeeds.js";

const LIST = "https://www.ville-exemple.fr/actualites";

test("liens : la navigation et les rubriques sont écartées, les articles retenus", () => {
  const html = `<html><body>
    <header><nav><a href="/espace-presse">Espace Presse et communiqués</a>
      <a href="/actualites/agenda-des-sorties-du-mois">Agenda des sorties du mois</a></nav></header>
    <main>
      <a href="/actualites/la-mediatheque-rouvre-ses-portes-apres-travaux">La médiathèque rouvre ses portes après travaux</a>
      <a href="/actualites/2026/10/conseil-municipal-du-12-octobre">Conseil municipal du 12 octobre : ce qui a été voté</a>
      <a href="/actualites?page=2">Page suivante des actualités</a>
      <a href="/files/bulletin-municipal-octobre.pdf">Bulletin municipal d'octobre (PDF)</a>
      <a href="https://www.facebook.com/ville-exemple/posts/123">Suivez-nous sur Facebook pour tout savoir</a>
      <a href="/contact">Nous contacter pour toute question</a>
    </main>
    <footer><a href="/mentions-legales-et-donnees-personnelles">Mentions légales et données</a></footer>
  </body></html>`;
  assert.deepEqual(listLinks(html, LIST), [
    "https://www.ville-exemple.fr/actualites/la-mediatheque-rouvre-ses-portes-apres-travaux",
    "https://www.ville-exemple.fr/actualites/2026/10/conseil-municipal-du-12-octobre",
  ]);
});

test("liens : un sélecteur CSS saisi l'emporte sur l'heuristique", () => {
  const html = `<div class="news"><a href="/a/court">x</a></div><main><a href="/actualites/un-long-titre-article-ici">Un long titre d'article ici</a></main>`;
  assert.deepEqual(listLinks(html, LIST, ".news a"), ["https://www.ville-exemple.fr/a/court"]);
});

test("liens : libellé trop court, autre site, page liste elle-même → écartés", () => {
  assert.equal(scoreLink("https://www.ville-exemple.fr/actualites/un-titre-assez-long", "Lire", LIST), null);
  assert.equal(scoreLink("https://autre-site.fr/actualites/un-titre-assez-long", "Un titre assez long pour passer", LIST), null);
  assert.equal(scoreLink(LIST + "/", "Toutes les actualités de la ville", LIST), null);
  assert.ok(sameSite("https://presse.ville-exemple.fr/x", LIST), "sous-domaine = même site");
});

test("liens : ordre de la page conservé, doublons et ancres fusionnés", () => {
  const c = [
    { href: "/actualites/premier-article-de-la-semaine", text: "Premier article de la semaine" },
    { href: "/actualites/premier-article-de-la-semaine#commentaires", text: "Premier article de la semaine" },
    { href: "/actualites/second-article-de-la-semaine", text: "Second article de la semaine" },
  ];
  assert.equal(pickArticleLinks(c, LIST).length, 2);
});

test("sitemap : index et urlset lus, lastmod en millisecondes", () => {
  const idx = parseSitemap(`<sitemapindex><sitemap><loc>https://x.fr/post-sitemap.xml</loc><lastmod>2026-10-10</lastmod></sitemap></sitemapindex>`);
  assert.equal(idx.isIndex, true);
  assert.equal(idx.entries[0].loc, "https://x.fr/post-sitemap.xml");
  const set = parseSitemap(`<urlset><url><loc><![CDATA[https://x.fr/a?b=1&amp;c=2]]></loc><lastmod>2026-10-12T08:00:00+02:00</lastmod></url><url><loc>https://x.fr/b</loc></url></urlset>`);
  assert.equal(set.entries[0].loc, "https://x.fr/a?b=1&c=2");
  assert.equal(set.entries[0].lastmod, Date.parse("2026-10-12T08:00:00+02:00"));
  assert.equal(set.entries[1].lastmod, 0);
  assert.equal(slugText("https://x.fr/actualites/la-fete-du-port.html"), "la fete du port");
});

test("rendement : la série vide se compte et l'alerte « muette » ne part qu'une fois", () => {
  let y;
  const fired = [];
  for (let i = 0; i < MUTE_AFTER + 2; i++) {
    const r = recordYield(y, { ok: true, count: 0 });
    y = r.yield;
    fired.push(r.muteNow);
  }
  assert.equal(fired.filter(Boolean).length, 1);
  assert.equal(fired.indexOf(true), MUTE_AFTER - 1);
  assert.equal(y.emptyStreak, MUTE_AFTER + 2);
  y = recordYield(y, { ok: false }).yield;
  assert.equal(y.emptyStreak, MUTE_AFTER + 2, "un échec ne remet pas la série à zéro");
  y = recordYield(y, { ok: true, count: 3, at: "2026-10-14T08:00:00Z" }).yield;
  assert.equal(y.emptyStreak, 0);
  assert.equal(y.lastItemAt, "2026-10-14T08:00:00Z");
  for (let i = 0; i < 5; i++) y = recordYield(y, { ok: true, count: 1 }).yield;
  assert.equal(y.runs, 14);
  assert.equal(y.recent.length, 10, "historique borné");
});

test("score : nouvelle, muette, fiable, et volet éditorial pris en compte au-delà de 3 décisions", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  assert.equal(reliabilityOf(undefined).level, "nouvelle");

  const run = (n, ok = true) => ({ at: "2026-10-14T08:00:00Z", ok, n });
  const good = { recent: [run(2), run(1), run(3), run(1)], lastItemAt: "2026-10-13T08:00:00Z", emptyStreak: 0 };
  const r = reliabilityOf(good, {}, now);
  assert.equal(r.level, "fiable");
  assert.ok(r.score >= 90);

  const mute = { recent: Array.from({ length: 6 }, () => run(0)), lastItemAt: null, emptyStreak: 6 };
  const m = reliabilityOf(mute, {}, now);
  assert.equal(m.level, "muette");
  assert.match(m.reasons.join(), /aucun contenu/);

  const rejected = reliabilityOf(good, { archive: 4, signale: 1, publie: 0 }, now);
  assert.ok(rejected.score < r.score, "des articles écartés font baisser le score");
  assert.match(rejected.reasons.join(), /écartés sur 5/);
});

test("découverte : liens de flux déclarés, et flux d'offres d'emploi reconnus", () => {
  const html = `<head><link rel="alternate" type="application/rss+xml" href="/feed/"><link rel="alternate" hreflang="en" href="/en"></head>`;
  assert.deepEqual(feedLinksIn(html, "https://www.aytre.fr/"), ["https://www.aytre.fr/feed/"]);
  assert.equal(jobShare(["Employé de restauration (H/F)", "Chef de cuisine en CDI", "Du verger à l'assiette"]), 2 / 3);
});
