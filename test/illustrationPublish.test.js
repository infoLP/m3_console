/* M3-66 — Illustration posée par le relecteur → `featured_media` WordPress.
   Le transport est SIMULÉ (`fetch` et `getImage` injectés) : ni WordPress, ni
   le web, ni le DNS ne sont appelés. Un faux site sert à la fois l'API REST
   (rest_route) et des images distantes (http://img.test/…). La connexion réelle
   à l'IP vérifiée (safeGet) est éprouvée dans illustrationSafeGet.test.js. */

import test from "node:test";
import assert from "node:assert/strict";

import { asBlocks } from "../shared/model.js";
import { MAX_IMAGE_BYTES, mediaIdFromLink, resolveFeaturedMedia } from "../src/publish/illustration.js";
import { checkIllustrationUrl, privateHostName, privateIp } from "../src/publish/illustrationUrl.js";
import { PRIVATE_ADDRESS } from "../src/publish/safeGet.js";
import { createWpClient } from "../src/publish/wpClient.js";
import { publish } from "../src/publish/wordpress.js";
import { buildPayload } from "../src/publish/payload.js";

const SITE = "http://wp.test";
const ENV = { M3_WP_URL: SITE, M3_WP_USER: "m3", M3_WP_APP_PASSWORD: "abcd efgh" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const article = (illustration) => ({
  id: "art-illo-1",
  title: "Le port mise sur l'hydrogène",
  chapo: "Chapô.",
  cat: "Économie",
  body: asBlocks([{ type: "p", text: "Paragraphe." }]),
  seo: { metaTitle: "", metaDescription: "", slug: "port-hydrogene", keywords: [] },
  illustration,
});

/* Téléchargement simulé, au contrat de safeGet : refus PRIVATE_ADDRESS si le
   nom résout (table `hosts`) vers une IP privée, redirections non suivies,
   `cancel()` journalisé dans `wp.cancelled`. */
const fakeGet = (wp, hosts = {}) => async (url, { allowPrivate = false } = {}) => {
  const ip = hosts[new URL(url).hostname];
  if (!allowPrivate && ip && privateIp(ip)) throw Object.assign(new Error("adresse privée"), { code: PRIVATE_ADDRESS });
  const res = await wp.fetch(url, { method: "GET" });
  return { status: res.status, ok: res.ok, headers: res.headers, body: res.body, cancel: () => { wp.cancelled.push(url); return res.body?.cancel(); } };
};

/* Médiathèque en mémoire (id 42 déjà présent), ressources distantes servies par
   URL (image, ou redirection `{ redirect }`), chaque requête journalisée. */
function fakeSite({ images = {}, failMedia = false } = {}) {
  const calls = [];
  const media = [{ id: 42, source_url: `${SITE}/wp-content/uploads/2026/10/port.jpg`,
    media_details: { sizes: { medium: { source_url: `${SITE}/wp-content/uploads/2026/10/port-300x200.jpg` } } } }];
  let nextId = 900;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const route = u.searchParams.get("rest_route");
    calls.push({ method: init.method, url, route, search: u.search, headers: init.headers, body: init.body });
    if (!route) {
      const img = images[url];
      if (!img) return new Response("Not Found", { status: 404, headers: { "content-type": "text/html" } });
      if (img.redirect) return new Response(null, { status: 302, headers: { location: img.redirect } });
      return new Response(img.body, { status: 200, headers: { "content-type": img.type, ...(img.length ? { "content-length": String(img.length) } : {}) } });
    }
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (route === "/wp/v2/categories" && init.method === "GET") return json(200, [{ id: 2, name: "Économie", slug: "economie" }]);
    if (route === "/wp/v2/tags" && init.method === "GET") return json(200, []);
    if (route === "/wp/v2/media" && init.method === "GET") {
      const s = u.searchParams.get("search") || "";
      return json(200, media.filter((m) => m.source_url.includes(s)));
    }
    if (route === "/wp/v2/media" && init.method === "POST") {
      if (failMedia) return json(500, { code: "boom", message: "panne simulée" });
      const m = { id: nextId++, source_url: `${SITE}/wp-content/uploads/new.png` };
      media.push(m);
      return json(201, m);
    }
    const one = route.match(/^\/wp\/v2\/media\/(\d+)$/);
    if (one && init.method === "GET") {
      const m = media.find((x) => x.id === +one[1]);
      return m ? json(200, m) : json(404, { code: "rest_post_invalid_id", message: "Identifiant de publication non valide." });
    }
    if (one && init.method === "POST") return json(200, { id: +one[1], ...body });
    if (route === "/wp/v2/posts" && init.method === "POST") return json(201, { id: 500, status: "draft", slug: body.slug, link: `${SITE}/?p=500` });
    const upd = route.match(/^\/wp\/v2\/posts\/(\d+)$/);
    if (upd && init.method === "POST") return json(200, { id: +upd[1], status: body.status, link: `${SITE}/port-hydrogene/` });
    return json(404, { code: "rest_no_route", message: "No route" });
  };
  return { fetch, calls, media, cancelled: [] };
}
const run = (wp, illustration, hosts) => publish(article(illustration), {}, { env: ENV, fetch: wp.fetch, getImage: fakeGet(wp, hosts), journal: async () => {} });
const postBody = (wp) => JSON.parse(wp.calls.find((c) => c.route === "/wp/v2/posts" && c.method === "POST").body);
const uploads = (wp) => wp.calls.filter((c) => c.route === "/wp/v2/media" && c.method === "POST");
const downloads = (wp) => wp.calls.filter((c) => !c.route);

/* ---------- Critère 1 : URL distante téléversée, featured_media numérique ---------- */

test("illustration par URL : téléversée dans la médiathèque, l'article porte un featured_media numérique", async () => {
  const wp = fakeSite({ images: { "http://img.test/photos/quai.png": { body: PNG, type: "image/png" } } });
  const rec = await run(wp, { url: "http://img.test/photos/quai.png", credit: "© Agence" });

  const up = uploads(wp);
  assert.equal(up.length, 1, "un seul téléversement");
  assert.equal(up[0].headers["Content-Type"], "image/png");
  assert.match(up[0].headers["Content-Disposition"], /filename="quai\.png"/);
  assert.deepEqual(Buffer.from(up[0].body), PNG, "le binaire part tel quel");

  const body = postBody(wp);
  assert.equal(typeof body.featured_media, "number");
  assert.equal(body.featured_media, 900);
  assert.equal(rec.illustration.mediaId, 900);
  assert.equal(rec.illustration.uploaded, true);
  assert.equal(rec.illustrationError, null);

  /* Crédit et URL d'origine gardés avec le média (droit d'usage, TODO M3-66). */
  const meta = wp.calls.find((c) => c.route === "/wp/v2/media/900" && c.method === "POST");
  assert.deepEqual(JSON.parse(meta.body), { caption: "© Agence", description: "Source : http://img.test/photos/quai.png" });

  /* L'image est posée AVANT l'article : il naît avec elle. */
  assert.ok(wp.calls.indexOf(up[0]) < wp.calls.findIndex((c) => c.route === "/wp/v2/posts"));
});

test("redirection vers une autre image publique : suivie, l'image d'arrivée est téléversée", async () => {
  const wp = fakeSite({ images: {
    "http://img.test/court": { redirect: "https://cdn.test/vrai.webp" },
    "https://cdn.test/vrai.webp": { body: PNG, type: "image/webp" },
  } });
  const rec = await run(wp, { url: "http://img.test/court", credit: "" });
  assert.equal(rec.illustrationError, null);
  assert.match(uploads(wp)[0].headers["Content-Disposition"], /filename="vrai\.webp"/);
  assert.equal(postBody(wp).featured_media, 900);
  assert.deepEqual(wp.cancelled, ["http://img.test/court"], "corps de la 3xx annulé, pas lu");
});

/* ---------- Critère 2 : lien médiathèque réutilisé, sans téléversement ---------- */

for (const lien of [
  `${SITE}/wp-admin/upload.php?item=42`,
  `${SITE}/wp-admin/post.php?post=42&action=edit`,
  `${SITE}/?attachment_id=42`,
  `${SITE}/wp-content/uploads/2026/10/port.jpg`,
  `${SITE}/wp-content/uploads/2026/10/port-300x200.jpg`,
]) {
  test(`illustration par lien médiathèque (${new URL(lien).pathname}${new URL(lien).search}) : id 42 réutilisé, aucun téléversement`, async () => {
    const wp = fakeSite();
    const rec = await run(wp, { url: lien, credit: "" });
    assert.equal(uploads(wp).length, 0);
    assert.equal(downloads(wp).length, 0, "rien n'est téléchargé");
    assert.equal(postBody(wp).featured_media, 42);
    assert.equal(rec.illustration.reused, true);
  });
}

test("lien vers un média absent de la médiathèque : erreur lisible, l'article part sans image", async () => {
  const wp = fakeSite();
  const rec = await run(wp, { url: `${SITE}/wp-admin/upload.php?item=999`, credit: "" });
  assert.equal(postBody(wp).featured_media, undefined);
  assert.match(rec.illustrationError, /introuvable dans la médiathèque/);
  assert.equal(rec.wpStatus, "publish", "publication faite");
});

test("lien d'un autre site : ce n'est pas un lien médiathèque", () => {
  assert.equal(mediaIdFromLink("http://autre.test/wp-admin/upload.php?item=42", SITE), null);
  assert.equal(mediaIdFromLink(`${SITE}/?rest_route=/wp/v2/media/7`, SITE), 7);
  assert.equal(mediaIdFromLink(`${SITE}/wp-json/wp/v2/media/8`, SITE), 8);
  assert.equal(mediaIdFromLink(`${SITE}/?attachment_id=abc`, SITE), null);
});

/* ---------- Critère 3 : URL invalide ou non-image, publication non bloquée ---------- */

test("contrôle d'adresse : invalide, non http, fichier non image → message ; vide ou plausible → rien", () => {
  assert.equal(checkIllustrationUrl(""), null);
  assert.equal(checkIllustrationUrl("https://img.test/a.JPG"), null);
  assert.equal(checkIllustrationUrl("https://img.test/image?id=3"), null, "sans extension : vérifié au téléchargement");
  assert.match(checkIllustrationUrl("pas une url"), /pas une URL valide/);
  assert.match(checkIllustrationUrl("ftp://img.test/a.jpg"), /http:\/\/ ou https:\/\//);
  assert.match(checkIllustrationUrl("https://img.test/doc.pdf"), /ne pointe pas vers une image \(fichier \.pdf\)/);
});

test("adresses privées : boucle locale, réseau local, métadonnées, IPv6 et IPv4 dans IPv6", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "198.18.0.1", "198.19.255.254", "192.0.0.8", "::ffff:c612:1",
    /* T5 : IPv4 embarquée jugée (compatible, NAT64, 6to4) ; NAT64 local, multicast, site local, illisible. */
    "::7f00:1", "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "64:ff9b:1::5db8:d822", "2002:7f00:1::", "2002:a9fe:a9fe::1",
    "ff02::1", "fec0::1", "feff::1", "fe80::1%eth0", "gggg::1", "1:2:3:4:5:6:7:8:9",
    "::", "FE80::1", "::FFFF:7F00:1", "::ffff:1.2.3", "::ffff:127.0.0.1%eth0", "[::ffff:127.0.0.1%25eth0]"])
    assert.equal(privateIp(ip), true, ip);
  for (const ip of ["93.184.216.34", "172.32.0.1", "198.17.255.255", "198.20.0.1", "192.0.1.1", "::5db8:d822", "64:ff9b::5db8:d822", "2002:5db8:d822::1", "fe7f::1", "2606:4700::1111", "::ffff:5db8:d822"]) assert.equal(privateIp(ip), false, ip);
  for (const h of ["localhost", "api.localhost", "nas.local", "metadata.google.internal", "[::ffff:7f00:1]"]) assert.equal(privateHostName(h), true, h);
  assert.equal(privateHostName("img.test"), false);
});

for (const [cas, url, images, hosts, attendu] of [
  ["URL invalide", "pas une url", {}, {}, /pas une URL valide/],
  ["page HTML", "http://img.test/page", { "http://img.test/page": { body: "<html>", type: "text/html; charset=utf-8" } }, {}, /ne renvoie pas une image \(text\/html\)/],
  ["image absente (404)", "http://img.test/absente.jpg", {}, {}, /HTTP 404/],
  ["IP privée saisie", "http://192.168.1.10/a.jpg", {}, {}, /réseau local/],
  ["IPv4 dans IPv6", "http://[::ffff:127.0.0.1]/a.jpg", {}, {}, /réseau local/],
  ["nom qui résout vers une IP privée", "http://interne.test/a.jpg", {}, { "interne.test": "10.0.0.5" }, /réseau local/],
  ["redirection vers les métadonnées du nuage", "http://img.test/piege.jpg", { "http://img.test/piege.jpg": { redirect: "http://169.254.169.254/latest/meta-data/" } }, {}, /réseau local/],
  ["redirection vers la boucle locale", "http://img.test/piege2.jpg", { "http://img.test/piege2.jpg": { redirect: "http://localhost:8080/x.png" } }, {}, /réseau local/],
  ["redirection vers un nom privé", "http://img.test/piege3.jpg", { "http://img.test/piege3.jpg": { redirect: "http://intranet.test/x.png" } }, { "intranet.test": "192.168.0.2" }, /réseau local/],
  ["trop de redirections", "http://img.test/r0", { "http://img.test/r0": { redirect: "/r1" }, "http://img.test/r1": { redirect: "/r2" }, "http://img.test/r2": { redirect: "/r3" }, "http://img.test/r3": { redirect: "/r4" } }, {}, /plus de 3 redirections/],
  ["taille annoncée trop grande", "http://img.test/geante.png", { "http://img.test/geante.png": { body: PNG, type: "image/png", length: MAX_IMAGE_BYTES + 1 } }, {}, /dépasse 10 Mo/],
  ["taille réelle trop grande, sans en-tête", "http://img.test/geante2.png", { "http://img.test/geante2.png": { body: Buffer.alloc(MAX_IMAGE_BYTES + 1), type: "image/png" } }, {}, /dépasse 10 Mo/],
]) {
  test(`${cas} : erreur lisible, rien de téléversé, l'article est publié sans image`, async () => {
    const wp = fakeSite({ images });
    const rec = await run(wp, { url, credit: "" }, hosts);
    assert.match(rec.illustrationError, attendu);
    assert.equal(uploads(wp).length, 0);
    assert.equal(postBody(wp).featured_media, undefined);
    assert.equal(rec.wpStatus, "publish");
    assert.ok(downloads(wp).every((c) => !/169\.254|localhost|intranet|interne|192\.168|\[::ffff/.test(c.url)), "aucune connexion vers l'hôte privé");
  });
}

test("échec du téléversement côté WordPress : erreur lisible, publication non bloquée", async () => {
  const wp = fakeSite({ failMedia: true, images: { "http://img.test/q.png": { body: PNG, type: "image/png" } } });
  const rec = await run(wp, { url: "http://img.test/q.png", credit: "" });
  assert.match(rec.illustrationError, /Illustration non transmise : WordPress 500/);
  assert.equal(postBody(wp).featured_media, undefined);
  assert.equal(rec.wpStatus, "publish");
});

test("sans illustration : aucun appel média, pas d'erreur", async () => {
  const wp = fakeSite();
  const rec = await run(wp, null);
  assert.equal(wp.calls.filter((c) => c.route?.startsWith("/wp/v2/media")).length, 0);
  assert.equal(rec.illustration, null);
  assert.equal(rec.illustrationError, null);
});

test("charge utile : l'illustration voyage sous un nom neutre, case vide = null", () => {
  assert.deepEqual(buildPayload(article({ url: " http://img.test/a.png ", credit: "© X" }), {}).illustration, { url: "http://img.test/a.png", credit: "© X" });
  assert.equal(buildPayload(article({ url: "", credit: "© X" }), {}).illustration, null);
});

test("resolveFeaturedMedia ne lève jamais, même si WordPress est injoignable", async () => {
  const client = createWpClient({ url: SITE, user: "u", appPassword: "p", fetch: async () => { throw new Error("ECONNREFUSED"); } });
  const r = await resolveFeaturedMedia(client, { url: `${SITE}/?attachment_id=42` }, { siteUrl: SITE });
  assert.equal(r.mediaId, null);
  assert.match(r.error, /injoignable/);
});
