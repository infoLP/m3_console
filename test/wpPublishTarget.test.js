/* M3-53 — publication vers une cible enregistrée : statut « brouillon » respecté,
   identifiants pris sur la cible, requêtes toujours faites par ?rest_route= (donc sans
   dépendre des permaliens du site), test de connexion. Transport simulé (`fetch`
   injecté) : aucun test n'appelle un vrai WordPress. */

import test from "node:test";
import assert from "node:assert/strict";

import { asBlocks } from "../shared/model.js";
import { createWpClient, restRouteUrl, WpError } from "../src/publish/wpClient.js";
import { checkWpTarget } from "../src/publish/wpCheck.js";
import { publish } from "../src/publish/wordpress.js";

const ARTICLE = {
  id: "art-cible-1",
  title: "Le port mise sur l'hydrogène",
  chapo: "Un investissement de 42 millions d'euros.",
  cat: "Économie",
  body: asBlocks([{ type: "p", text: "Premier paragraphe." }]),
  seo: { metaTitle: "Hydrogène vert : le port investit", metaDescription: "Le port engage 42 millions d'euros.", slug: "port-hydrogene-vert", keywords: ["hydrogène"] },
};

const CIBLE = { id: 7, name: "Vie économique", url: "https://wp.test", user: "console", appPassword: "abcd efgh", seoPlugin: "rankmath", createCategories: false, publishStatus: "draft" };

const reply = (status, body) => ({ ok: status < 400, status, statusText: "", text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

/* WordPress minimal : rubrique « Économie », mots-clés créés à la volée, articles en
   mémoire. Il se comporte comme un site SANS permaliens : tout ce qui n'est pas
   `?rest_route=` reçoit la page 404 du thème, comme /wp-json/ le ferait. */
function fakeWp() {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    const route = u.searchParams.get("rest_route");
    calls.push({ method: init.method, url: String(url), path: route, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null });
    if (!route) return reply(404, "<html>Page introuvable</html>");
    if (route === "/wp/v2/users/me") return reply(200, { id: 3, name: "Console M3", roles: ["editor"] });
    if (route === "/wp/v2/categories" && init.method === "GET") return reply(200, [{ id: 2, name: "Économie", slug: "economie" }]);
    if (route === "/wp/v2/tags" && init.method === "GET") return reply(200, []);
    if (route === "/wp/v2/tags" && init.method === "POST") return reply(201, { id: 55, name: JSON.parse(init.body).name });
    if (route === "/wp/v2/posts" && init.method === "POST") return reply(201, { id: 500, status: "draft", slug: "port-hydrogene-vert", link: "https://wp.test/?p=500" });
    if (/^\/wp\/v2\/posts\/\d+$/.test(route)) return reply(200, { id: 500, status: JSON.parse(init.body).status, slug: "port-hydrogene-vert", link: "https://wp.test/port-hydrogene-vert/" });
    if (route === "/rankmath/v1/updateMeta") return reply(200, { slug: true });
    return reply(404, { code: "rest_no_route", message: "Aucune route" });
  };
  return { fetch, calls };
}

const SANS_JOURNAL = { journal: async () => {} };

/* ----------------------------------------------------- client : ?rest_route= */

test("restRouteUrl : la route REST devient ?rest_route=, paramètres conservés", () => {
  assert.equal(restRouteUrl("https://wp.test", "/wp/v2/posts"), "https://wp.test/?rest_route=%2Fwp%2Fv2%2Fposts");
  const u = new URL(restRouteUrl("https://wp.test", "/wp/v2/tags?search=hydrog%C3%A8ne&per_page=100"));
  assert.equal(u.searchParams.get("rest_route"), "/wp/v2/tags");
  assert.equal(u.searchParams.get("search"), "hydrogène");
  assert.equal(u.searchParams.get("per_page"), "100");
});

test("restRouteUrl : refuse une route écrite à l'ancienne (/wp-json/…) ou sans « / » initial", () => {
  assert.throws(() => restRouteUrl("https://wp.test", "/wp-json/wp/v2/posts"), /sans préfixe \/wp-json/);
  assert.throws(() => restRouteUrl("https://wp.test", "wp/v2/posts"), /route REST attendue/);
});

test("client : toutes les requêtes passent par ?rest_route=, aucune par /wp-json/", async () => {
  const wp = fakeWp();
  const client = createWpClient({ url: "https://wp.test", user: "u", appPassword: "p", fetch: wp.fetch });
  await client.get("/wp/v2/users/me?context=edit");
  await client.post("/wp/v2/tags", { name: "x" });
  assert.equal(wp.calls.length, 2);
  assert.ok(wp.calls.every((c) => c.url.startsWith("https://wp.test/?rest_route=") && !c.url.includes("/wp-json")));
  assert.equal(new URL(wp.calls[0].url).searchParams.get("context"), "edit");
});

test("client : un 404 JSON (ressource absente) est rendu tel quel, avec son code", async () => {
  const fetch = async () => reply(404, { code: "rest_post_invalid_id", message: "ID invalide." });
  const client = createWpClient({ url: "https://wp.test", user: "u", appPassword: "p", fetch });
  await assert.rejects(client.get("/wp/v2/posts/9"), (e) => e instanceof WpError && e.status === 404 && e.code === "rest_post_invalid_id");
});

test("client : site injoignable → WpError sans statut, avec la route dans le message", async () => {
  const client = createWpClient({ url: "https://wp.test", user: "u", appPassword: "p", fetch: async () => { throw new Error("ECONNREFUSED"); } });
  await assert.rejects(client.get("/wp/v2/users/me"), (e) => e instanceof WpError && e.status === 0 && /GET \/wp\/v2\/users\/me/.test(e.message));
});

/* -------------------------------------------------------- test de connexion */

test("checkWpTarget : compte Éditeur → connexion réussie, rôles affichés", async () => {
  const r = await checkWpTarget({ url: "https://wp.test", user: "console", appPassword: "x" }, { fetch: fakeWp().fetch });
  assert.equal(r.ok, true);
  assert.deepEqual(r.roles, ["editor"]);
  assert.match(r.message, /Connecté : Console M3 \(editor\)/);
  assert.equal(Object.hasOwn(r, "viaRestRoute"), false);
});

test("checkWpTarget : rôle sans droit d'écriture → refusé, et dit pourquoi", async () => {
  const fetch = async () => reply(200, { name: "Lecteur", roles: ["subscriber"] });
  const r = await checkWpTarget({ url: "https://wp.test", user: "l", appPassword: "x" }, { fetch });
  assert.equal(r.ok, false);
  assert.match(r.message, /ne permet pas d'écrire/);
});

test("checkWpTarget : identifiants refusés (401) et adresse introuvable (404) sont expliqués", async () => {
  const non = await checkWpTarget({ url: "https://wp.test", user: "u", appPassword: "mauvais" }, { fetch: async () => reply(401, { code: "incorrect_password", message: "x" }) });
  assert.equal(non.ok, false);
  assert.match(non.message, /Identifiants refusés/);
  const introuvable = await checkWpTarget({ url: "https://wp.test", user: "u", appPassword: "x" }, { fetch: async () => reply(404, "<html></html>") });
  assert.match(introuvable.message, /introuvable/);
  const eteint = await checkWpTarget({ url: "https://wp.test", user: "u", appPassword: "x" }, { fetch: async () => { throw new Error("ECONNREFUSED"); } });
  assert.match(eteint.message, /injoignable/);
});

/* --------------------------------------------- publier vers une cible enregistrée */

test("cible « brouillon » : l'article reste brouillon dans WordPress, rien n'est mis en ligne", async () => {
  const wp = fakeWp();
  const r = await publish(ARTICLE, {}, { target: CIBLE, fetch: wp.fetch, by: "a.sanchez", byRole: "administrateur", ...SANS_JOURNAL });
  assert.equal(r.sentAsDraft, true);
  assert.equal(r.wpStatus, "draft");
  assert.equal(r.targetId, 7);
  assert.equal(r.targetName, "Vie économique");
  assert.equal(wp.calls.some((c) => /^\/wp\/v2\/posts\/\d+$/.test(c.path)), false, "aucune requête de mise en ligne");
  const creation = wp.calls.find((c) => c.path === "/wp/v2/posts");
  assert.equal(creation.body.status, "draft");
});

test("cible « mise en ligne directe » : brouillon d'abord, puis passage en publish", async () => {
  const wp = fakeWp();
  const r = await publish(ARTICLE, {}, { target: { ...CIBLE, publishStatus: "publish" }, fetch: wp.fetch, ...SANS_JOURNAL });
  assert.equal(r.sentAsDraft, false);
  assert.equal(r.wpStatus, "publish");
  const miseEnLigne = wp.calls.find((c) => c.path === "/wp/v2/posts/500");
  assert.equal(miseEnLigne.body.status, "publish");
  assert.ok(wp.calls.findIndex((c) => c.path === "/wp/v2/posts") < wp.calls.indexOf(miseEnLigne));
});

test("les identifiants et le greffon viennent de la cible, pas de l'environnement", async () => {
  const wp = fakeWp();
  await publish(ARTICLE, {}, { target: CIBLE, fetch: wp.fetch, env: { M3_WP_URL: "https://ailleurs.test", M3_WP_USER: "autre", M3_WP_APP_PASSWORD: "zzz" }, ...SANS_JOURNAL });
  const attendu = "Basic " + Buffer.from("console:abcd efgh").toString("base64");
  assert.ok(wp.calls.every((c) => c.auth === attendu));
  assert.ok(wp.calls.every((c) => c.url.startsWith("https://wp.test/")), "jamais l'adresse de l'environnement");
  assert.ok(wp.calls.some((c) => c.path === "/rankmath/v1/updateMeta"), "greffon Rank Math de la cible");
});

test("site sans permaliens : la publication aboutit, sans aucune requête par /wp-json/", async () => {
  const wp = fakeWp();
  const r = await publish(ARTICLE, {}, { target: { ...CIBLE, publishStatus: "publish" }, fetch: wp.fetch, ...SANS_JOURNAL });
  assert.equal(r.wpStatus, "publish");
  assert.ok(wp.calls.length >= 5);
  assert.ok(wp.calls.every((c) => c.path), "toutes les requêtes portent ?rest_route=");
});

test("sans cible, l'environnement (M3_WP_*) reste le mode historique : mise en ligne", async () => {
  const wp = fakeWp();
  const env = { M3_WP_URL: "https://wp.test", M3_WP_USER: "console", M3_WP_APP_PASSWORD: "abcd efgh" };
  const r = await publish(ARTICLE, {}, { env, fetch: wp.fetch, ...SANS_JOURNAL });
  assert.equal(r.sentAsDraft, false);
  assert.equal(r.targetId, null);
});

test("un échec WordPress laisse un brouillon identifié, pas un article à moitié posé", async () => {
  const wp = fakeWp();
  const fetch = async (url, init) => {
    if (new URL(url).searchParams.get("rest_route") === "/rankmath/v1/updateMeta") return reply(500, { code: "boom", message: "panne" });
    return wp.fetch(url, init);
  };
  await assert.rejects(
    publish(ARTICLE, {}, { target: { ...CIBLE, publishStatus: "publish" }, fetch, ...SANS_JOURNAL }),
    (e) => /resté en brouillon \(WordPress #500\)/.test(e.message)
  );
});
