/* M3-110 — test d'une source en lecture seule (src/api/sources.js) : vrai code
   de récolte, fetch simulé, aucune base. Le module ne doit importer aucune
   fonction d'écriture de la récolte (état, rendement, notification). */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { testerSourceLectureSeule, testerAvecVerrou } from "../src/api/sources.js";

const realFetch = globalThis.fetch;
const reponse = (status, body, type = "text/html") => new Response(body, { status, headers: { "content-type": type } });
const para = (n) => `<p>${"Texte de paragraphe assez long pour compter. ".repeat(n)}</p>`;
const page = (title, n) => `<html><head><title>${title}</title></head><body><article><h1>${title}</h1>${para(n)}</article></body></html>`;

function installFetch(handler) {
  globalThis.fetch = async (url, init) => handler(String(url), init);
}
test.afterEach(() => { globalThis.fetch = realFetch; });

const now = Date.now();
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Flux</title>${items.map((i) => `<item><title>${i.t}</title><link>${i.l}</link><pubDate>${new Date(now - 86400000).toUTCString()}</pubDate><description>${i.d}</description></item>`).join("")}</channel></rss>`;

test("rss : items, complets (texte >= 500) et exemples limités à 3", async () => {
  const long = "x".repeat(600);
  installFetch((url) => {
    if (url === "https://ex.fr/rss") return reponse(200, rss([
      { t: "A", l: "https://ex.fr/a", d: long }, { t: "B", l: "https://ex.fr/b", d: long },
      { t: "C", l: "https://ex.fr/c", d: "court" }, { t: "D", l: "https://ex.fr/d", d: long },
    ]), "application/rss+xml");
    return reponse(404, "");
  });
  const r = await testerSourceLectureSeule({ id: "s1", rssUrl: "https://ex.fr/rss" });
  assert.equal(r.ok, true);
  assert.equal(r.via, "rss");
  assert.equal(r.items, 4);
  assert.equal(r.complets, 3);
  assert.equal(r.exemples.length, 3);
  assert.equal(r.erreur, null);
  assert.equal(r.antiRobot, false);
  assert.equal(typeof r.dureeMs, "number");
});

test("page liste : les articles sont récupérés", async () => {
  const lien = (i) => `<a href="/actualites/article-numero-${i}-sur-le-projet-communal">Article numéro ${i} sur le projet communal</a>`;
  installFetch((url) => {
    if (url === "https://ex.fr/actualites") return reponse(200, `<html><body><main>${[1, 2].map(lien).join("")}</main></body></html>`);
    if (url.includes("article-numero-")) return reponse(200, page(`Titre ${url.slice(-30)}`, 20));
    return reponse(404, "");
  });
  const r = await testerSourceLectureSeule({ id: "s2", listUrl: "https://ex.fr/actualites" });
  assert.equal(r.ok, true);
  assert.equal(r.items, 2);
  assert.equal(r.complets, 2);
  assert.ok(["list", "selector", "sitemap"].includes(r.via));
});

test("HTTP 403 : échec, http 403, antiRobot", async () => {
  installFetch(() => reponse(403, "interdit"));
  const r = await testerSourceLectureSeule({ id: "s3", rssUrl: "https://ex.fr/rss" });
  assert.equal(r.ok, false);
  assert.equal(r.http, 403);
  assert.equal(r.antiRobot, true);
  assert.match(r.erreur, /403/);
});

test("HTTP 500 : échec sans antiRobot", async () => {
  installFetch(() => reponse(500, "boum"));
  const r = await testerSourceLectureSeule({ id: "s3b", rssUrl: "https://ex.fr/rss" });
  assert.equal(r.ok, false);
  assert.equal(r.http, 500);
  assert.equal(r.antiRobot, false);
});

test("délai dépassé : erreur, sans planter", async () => {
  installFetch((url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  const r = await testerSourceLectureSeule({ id: "s4", rssUrl: "https://ex.fr/rss" }, { budgetMs: 50, timeoutMs: 200 });
  assert.equal(r.ok, false);
  assert.match(r.erreur, /délai/);
  assert.equal(r.items, 0);
});

test("sans URL : ok false, aucune URL renseignée", async () => {
  const r = await testerSourceLectureSeule({ id: "s5" });
  assert.equal(r.ok, false);
  assert.equal(r.erreur, "aucune URL renseignée");
});

test("un second test pendant le premier : 409", async () => {
  let libere;
  installFetch(() => new Promise((resolve) => { libere = () => resolve(reponse(200, rss([]), "application/rss+xml")); }));
  const s = { id: "s6", rssUrl: "https://ex.fr/rss" };
  const premier = testerAvecVerrou(s);
  const second = await testerAvecVerrou(s);
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, { ok: false, erreur: "test déjà en cours" });
  libere();
  assert.equal((await premier).status, 200);
  installFetch(() => reponse(200, rss([]), "application/rss+xml"));
  assert.equal((await testerAvecVerrou(s)).status, 200); // verrou relâché
});

test("délai dépassé : le verrou tient tant que la récolte n'est pas finie", async () => {
  let libere;
  installFetch(() => new Promise((resolve) => { libere = () => resolve(reponse(200, rss([]), "application/rss+xml")); }));
  const s = { id: "s7", rssUrl: "https://ex.fr/rss" };
  const premier = await testerAvecVerrou(s, { budgetMs: 30 });
  assert.match(premier.body.erreur, /délai/);
  assert.equal((await testerAvecVerrou(s)).status, 409);   // la récolte court encore
  libere();
  await new Promise((r) => setTimeout(r, 20));
  installFetch(() => reponse(200, rss([]), "application/rss+xml"));
  assert.equal((await testerAvecVerrou(s)).status, 200);
});

test("lecture seule : aucune fonction d'écriture importée", () => {
  const src = fs.readFileSync(new URL("../src/api/sources.js", import.meta.url), "utf8");
  const bloc = src.slice(src.indexOf("const TEST_FENETRE_MS"));
  for (const w of ["writeJson", "pushCollection", "afterAttempt", "recordYield", "journal(", "query(", "writeSources"]) {
    assert.ok(!bloc.includes(w), `le test ne doit pas appeler ${w}`);
  }
});
