/* M3-53 / M3-94 — Publication WordPress : choix des champs SEO selon le greffon,
   résolution des rubriques et mots-clés en identifiants, ordre des requêtes.
   Le transport est SIMULÉ (`fetch` injecté) : ce test n'appelle jamais un vrai
   WordPress. Le prototype réel se constate à la main (docs/passation/PROTOTYPE-wordpress.md). */

import test from "node:test";
import assert from "node:assert/strict";

import { asBlocks } from "../shared/model.js";
import { SEO_PLUGINS, seoMetaFor, seoPlugin } from "../src/publish/seoPlugins.js";
import { resolveTerms, sameLabel } from "../src/publish/terms.js";
import { createWpClient } from "../src/publish/wpClient.js";
import { readWpConfig, readSeoPluginId, readPublishMode } from "../src/publish/wpConfig.js";
import { publish, wpPostBody } from "../src/publish/wordpress.js";
import { publisherFor } from "../src/publish/index.js";
import { publish as publishSimulated } from "../src/publish/simulated.js";
import { buildPayload } from "../src/publish/payload.js";

const ARTICLE = {
  id: "art-wp-1",
  title: "Le port mise sur l'hydrogène",
  chapo: "Un investissement de 42 millions d'euros.",
  cat: "Économie",
  body: asBlocks([
    { type: "p", text: "Premier paragraphe." },
    { type: "h2", text: "Un investissement lourd" },
    { type: "p", text: "Second paragraphe." },
  ]),
  seo: {
    metaTitle: "Hydrogène vert : le port investit 42 M€",
    metaDescription: "Le port engage 42 millions d'euros pour produire de l'hydrogène vert.",
    slug: "port-hydrogene-vert",
    keywords: ["hydrogène", "Port", "décarbonation"],
  },
};
const ENV = { M3_WP_URL: "http://wp.test", M3_WP_USER: "m3", M3_WP_APP_PASSWORD: "abcd efgh" };

/* Faux WordPress : rubriques et mots-clés en mémoire, chaque requête journalisée. */
function fakeWp({ categories = [{ id: 2, name: "Économie", slug: "economie" }, { id: 3, name: "Faits &amp; divers", slug: "faits-divers" }],
  tags = [{ id: 10, name: "port", slug: "port" }], failOn = null, existsOnCreate = null } = {}) {
  const calls = [];
  const db = { categories: [...categories], tags: [...tags] };
  let nextId = 100;
  const reply = (status, body) => ({ ok: status < 400, status, statusText: "", text: async () => JSON.stringify(body) });
  const fetch = async (url, init) => {
    const u = new URL(url);
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : null;
    const route = u.searchParams.get("rest_route");
    calls.push({ method, path: route, search: u.search, body, auth: init.headers.Authorization });
    if (failOn && failOn(method, route)) return reply(500, { code: "boom", message: "panne simulée" });
    const tax = route?.match(/^\/wp\/v2\/(categories|tags)$/)?.[1];
    if (tax && method === "GET") {
      /* Recherche large, comme WordPress : le tri fin revient à terms.js. */
      return reply(200, db[tax]);
    }
    if (tax && method === "POST") {
      if (existsOnCreate === body.name) return reply(400, { code: "term_exists", message: "existe", data: { status: 400, term_id: 77 } });
      const t = { id: nextId++, name: body.name, slug: body.name };
      db[tax].push(t);
      return reply(201, t);
    }
    if (route === "/wp/v2/posts" && method === "POST") return reply(201, { id: 500, status: "draft", slug: body.slug, link: "http://wp.test/?p=500" });
    const upd = route?.match(/^\/wp\/v2\/posts\/(\d+)$/);
    if (upd && method === "POST") return reply(200, { id: +upd[1], status: body.status, slug: "port-hydrogene-vert", link: "http://wp.test/port-hydrogene-vert/" });
    if (route === "/rankmath/v1/updateMeta") return reply(200, { slug: true, schemas: [] });
    return reply(404, { code: "rest_no_route", message: "No route" });
  };
  return { fetch, calls, db };
}
const noJournal = async () => {};

/* ---------- Table de correspondance des greffons ---------- */

test("champs SEO : Yoast et Rank Math reçoivent chacun leurs propres clés", () => {
  const y = seoMetaFor("yoast", ARTICLE.seo, ARTICLE.seo.keywords);
  assert.deepEqual(y, {
    _yoast_wpseo_title: ARTICLE.seo.metaTitle,
    _yoast_wpseo_metadesc: ARTICLE.seo.metaDescription,
    _yoast_wpseo_focuskw: "hydrogène",
  });
  const r = seoMetaFor("rankmath", ARTICLE.seo, ARTICLE.seo.keywords);
  assert.deepEqual(r, {
    rank_math_title: ARTICLE.seo.metaTitle,
    rank_math_description: ARTICLE.seo.metaDescription,
    rank_math_focus_keyword: "hydrogène",
  });
  assert.deepEqual(seoMetaFor("none", ARTICLE.seo, ARTICLE.seo.keywords), {});
});

test("champs SEO : une valeur vide n'est pas envoyée (Rank Math l'effacerait)", () => {
  assert.deepEqual(seoMetaFor("rankmath", { metaTitle: "  ", metaDescription: "" }, []), {});
});

test("greffon inconnu : erreur qui liste les choix ; réglage inconnu → « none »", () => {
  assert.throws(() => seoPlugin("seopress"), /yoast, rankmath, none/);
  assert.equal(readSeoPluginId({}, { M3_WP_SEO_PLUGIN: "SEOPress" }), "none");
  assert.equal(readSeoPluginId({}, { M3_WP_SEO_PLUGIN: " RankMath " }), "rankmath");
  for (const p of Object.values(SEO_PLUGINS)) assert.ok(["core-meta", "rankmath-endpoint", "none"].includes(p.via));
});

test("corps WordPress : brouillon d'abord ; méta Yoast dans la création, pas celles de Rank Math", () => {
  const payload = buildPayload(ARTICLE, { wp_target: "http://wp.test" });
  const terms = { categories: [2], tags: [10, 11] };
  const y = wpPostBody(payload, terms, { seoPluginId: "yoast" });
  assert.equal(y.status, "draft");
  assert.deepEqual(y.categories, [2]);
  assert.equal(y.meta._yoast_wpseo_title, ARTICLE.seo.metaTitle);
  assert.match(y.content, /<h2>Un investissement lourd<\/h2>/);
  assert.equal(y.seo, undefined, "les champs neutres ne partent pas tels quels");
  assert.equal(y._target, undefined);
  const r = wpPostBody(payload, terms, { seoPluginId: "rankmath" });
  assert.equal(r.meta, undefined);
});

/* ---------- Rubriques et mots-clés ---------- */

test("termes : libellés résolus en identifiants, mots-clés absents créés", async () => {
  const wp = fakeWp();
  const client = createWpClient({ url: "http://wp.test", user: "u", appPassword: "p", fetch: wp.fetch });
  const r = await resolveTerms(client, { categories: ["économie", "Faits & divers"], tags: ["Port", "hydrogène", "port", 42] });
  assert.deepEqual(r.categories, [2, 3], "casse ignorée, « &amp; » renvoyé par WordPress décodé");
  assert.equal(r.tags[0], 10, "« Port » retrouve « port » sans tenir compte de la casse");
  assert.equal(r.tags.length, 3, "doublon « port » écarté, identifiant numérique conservé");
  assert.ok(r.tags.includes(42));
  assert.deepEqual(r.created.tags, ["hydrogène"]);
  assert.deepEqual(r.created.categories, []);
});

test("termes : rubrique absente → erreur nommée, aucun mot-clé créé", async () => {
  const wp = fakeWp();
  const client = createWpClient({ url: "http://wp.test", user: "u", appPassword: "p", fetch: wp.fetch });
  await assert.rejects(resolveTerms(client, { categories: ["Culture"], tags: ["nouveau"] }), /Rubrique absente.*« Culture »/);
  assert.equal(wp.calls.filter((c) => c.method === "POST").length, 0);
});

test("termes : rubrique créée si le réglage l'autorise", async () => {
  const wp = fakeWp();
  const client = createWpClient({ url: "http://wp.test", user: "u", appPassword: "p", fetch: wp.fetch });
  const r = await resolveTerms(client, { categories: ["Culture"] }, { createCategories: true });
  assert.deepEqual(r.created.categories, ["Culture"]);
  assert.equal(r.categories.length, 1);
});

test("termes : mot-clé créé entre-temps par un autre envoi (term_exists) → identifiant repris", async () => {
  const wp = fakeWp({ existsOnCreate: "course" });
  const client = createWpClient({ url: "http://wp.test", user: "u", appPassword: "p", fetch: wp.fetch });
  const r = await resolveTerms(client, { tags: ["course"] });
  assert.deepEqual(r.tags, [77]);
});

test("libellés : entités HTML, casse et espaces ignorés ; accents comptés", () => {
  assert.ok(sameLabel("Faits &amp; divers", "faits  & DIVERS"));
  assert.ok(!sameLabel("Pêche", "Peche"));
});

/* ---------- Publication de bout en bout (transport simulé) ---------- */

test("Rank Math : termes → brouillon → méta SEO → mise en ligne, dans cet ordre", async () => {
  const wp = fakeWp();
  const journal = [];
  const rec = await publish(ARTICLE, { wp_target: "https://ignore.exemple" }, {
    env: { ...ENV, M3_WP_SEO_PLUGIN: "rankmath" }, fetch: wp.fetch, journal: async (c, r) => journal.push([c, r]), by: "alice",
  });
  const writes = wp.calls.filter((c) => c.method === "POST").map((c) => c.path);
  assert.deepEqual(writes, [
    "/wp/v2/tags", "/wp/v2/tags",              // hydrogène, décarbonation
    "/wp/v2/posts",                                     // brouillon
    "/rankmath/v1/updateMeta",                          // balise titre + méta-description
    "/wp/v2/posts/500",                                 // mise en ligne
  ]);
  const create = wp.calls.find((c) => c.path === "/wp/v2/posts");
  assert.equal(create.body.status, "draft", "jamais en ligne avant ses méta SEO");
  const rm = wp.calls.find((c) => c.path.includes("rankmath"));
  assert.deepEqual(rm.body, { objectType: "post", objectID: 500, meta: seoMetaFor("rankmath", ARTICLE.seo, ARTICLE.seo.keywords) });
  assert.equal(wp.calls.at(-1).body.status, "publish");
  assert.equal(create.auth, "Basic " + Buffer.from("m3:abcd efgh").toString("base64"));
  assert.equal(rec.wpId, 500);
  assert.equal(rec.url, "http://wp.test/port-hydrogene-vert/");
  assert.equal(rec.target, "http://wp.test", "M3_WP_URL l'emporte sur la cible fictive");
  assert.equal(rec.simulated, false);
  assert.equal(rec.seoSkipped, null);
  assert.equal(rec.payload.seo._plugin, "rankmath");
  assert.equal(journal.length, 1);
  assert.equal(journal[0][0], "publications");
  assert.equal(JSON.stringify(rec).includes("abcd efgh"), false, "le secret ne va pas au journal");
});

test("Yoast : méta SEO dans la création, aucune route propre au greffon", async () => {
  const wp = fakeWp();
  await publish(ARTICLE, {}, { env: { ...ENV, M3_WP_SEO_PLUGIN: "yoast" }, fetch: wp.fetch, journal: noJournal });
  assert.equal(wp.calls.some((c) => c.path.includes("rankmath")), false);
  const create = wp.calls.find((c) => c.path === "/wp/v2/posts");
  assert.equal(create.body.meta._yoast_wpseo_metadesc, ARTICLE.seo.metaDescription);
});

test("parution programmée : statut future et date UTC", async () => {
  const wp = fakeWp();
  const quand = "2026-12-01T09:00:00.000Z";
  const rec = await publish(ARTICLE, {}, { scheduledAt: quand, env: { ...ENV, M3_WP_SEO_PLUGIN: "yoast" }, fetch: wp.fetch, journal: noJournal });
  assert.deepEqual(wp.calls.at(-1).body, { status: "future", date_gmt: quand });
  assert.equal(rec.scheduledAt, quand);
  assert.equal(rec.publishedAt, null);
});

test("sans greffon : on publie, et le résultat dit ce qui n'est pas parti", async () => {
  const wp = fakeWp();
  const rec = await publish(ARTICLE, {}, { env: ENV, fetch: wp.fetch, journal: noJournal });
  assert.match(rec.seoSkipped, /aucun greffon/);
  assert.equal(wp.calls.find((c) => c.path === "/wp/v2/posts").body.meta, undefined);
});

test("échec des méta Rank Math : l'article reste en brouillon, l'erreur le dit", async () => {
  const wp = fakeWp({ failOn: (m, p) => p.includes("rankmath") });
  await assert.rejects(
    publish(ARTICLE, {}, { env: { ...ENV, M3_WP_SEO_PLUGIN: "rankmath" }, fetch: wp.fetch, journal: noJournal }),
    /resté en brouillon \(WordPress #500\)/,
  );
  assert.equal(wp.calls.some((c) => c.path === "/wp/v2/posts/500"), false, "jamais mis en ligne");
});

test("non configuré : refus avant tout appel réseau, manques nommés", async () => {
  const wp = fakeWp();
  await assert.rejects(
    publish(ARTICLE, { wp_target: "https://wordpress.exemple.fr" }, { env: {}, fetch: wp.fetch, journal: noJournal }),
    /identifiant \(M3_WP_USER\).*mot de passe d'application/,
  );
  assert.equal(wp.calls.length, 0);
});

/* ---------- Réglages ---------- */

test("réglages : réglage > environnement > défaut ; le secret ne vient que de l'environnement", () => {
  const c = readWpConfig({ wp_url: "https://site.fr/", wp_seo_plugin: "yoast", wp_user: "s" },
    { M3_WP_URL: "http://autre", M3_WP_USER: "e", M3_WP_APP_PASSWORD: "x", M3_WP_SEO_PLUGIN: "rankmath" });
  assert.equal(c.url, "https://site.fr");
  assert.equal(c.user, "s");
  assert.equal(c.seoPlugin, "yoast");
  assert.equal(c.configured, true);
  assert.equal(readWpConfig({ wp_app_password: "dans-les-reglages" }, { M3_WP_URL: "http://a", M3_WP_USER: "u" }).configured, false);
  assert.equal(readWpConfig({}, {}).seoPlugin, "none");
  assert.equal(readWpConfig({}, { M3_WP_CREATE_CATEGORIES: "oui" }).createCategories, true);
});

test("aiguillage : simulé par défaut, WordPress sur demande explicite", () => {
  assert.equal(readPublishMode({}, {}), "simulated");
  assert.equal(publisherFor({}, {}), publishSimulated);
  assert.equal(publisherFor({}, { M3_PUBLISH_MODE: "wordpress" }), publish);
  assert.equal(publisherFor({ publish_mode: "simulated" }, { M3_PUBLISH_MODE: "wordpress" }), publishSimulated);
});
