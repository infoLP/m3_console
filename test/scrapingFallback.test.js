/* M3-57 — repli rendu de la récolte des pages « liste » (src/ingest/fetchArticleList.js) :
   désactivé, rien ne change ; activé, il ne prend la main que si la passe statique
   n'a rien donné. Réseau simulé (globalThis.fetch) et rendu simulé (`renderer`). */

import test from "node:test";
import assert from "node:assert/strict";
import { harvestArticleList, looksJsRendered } from "../src/ingest/fetchArticleList.js";
import { rendererFor, fetchRendered, fetchStealth, closeRenderer } from "../src/ingest/fetchRendered.js";
import { fakeChromium } from "./outils/fauxChromium.js";

const LIST = "https://exemple.test/actualites";
const para = (s) => `<p>${s} ${"Le conseil municipal a présenté le projet aux habitants du quartier. ".repeat(4)}</p>`;
const article = (t) => `<html><head><title>${t}</title></head><body><article><h1>${t}</h1>${para(t)}${para(t)}</article></body></html>`;
const listPage = (n) => `<html><body><main>${Array.from({ length: n }, (_, i) =>
  `<a href="/actualites/2026/10/projet-${i}-renovation-ecole">Projet ${i} : rénovation de l'école du quartier</a>`).join("")}</main></body></html>`;
const SPA = `<html><head><script src="/app.js"></script></head><body><noscript>Activez JavaScript pour voir ce site.</noscript><div id="root"></div></body></html>`;

/* pages : url → html | nombre (statut HTTP d'erreur). Tout le reste : 404. */
function stubFetch(pages) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const p = pages[String(url)];
    if (typeof p === "string") return new Response(p, { status: 200, headers: { "content-type": "text/html" } });
    return new Response("", { status: typeof p === "number" ? p : 404 });
  };
  return { fetch, calls };
}

function stubRenderer(pages) {
  const calls = [];
  const renderer = async (url) => {
    calls.push(url);
    const p = pages[url];
    if (typeof p === "string") return p;
    throw new Error(`HTTP ${typeof p === "number" ? p : 404}`);
  };
  return { renderer, calls };
}

async function withFetch(pages, fn) {
  const saved = globalThis.fetch;
  const stub = stubFetch(pages);
  globalThis.fetch = stub.fetch;
  try { return await fn(stub); } finally { globalThis.fetch = saved; }
}

const articles = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) =>
  [`https://exemple.test/actualites/2026/10/projet-${i}-renovation-ecole`, article(`Projet ${i}`)]));

test("détection d'une page construite en JavaScript", () => {
  assert.equal(looksJsRendered(SPA), true);
  assert.equal(looksJsRendered(listPage(3)), false);
  /* coquille #root mais vrai contenu serveur : pas une page JS */
  assert.equal(looksJsRendered(`<div id="root"></div>${para("x").repeat(5)}`), false);
});

test("repli désactivé par défaut : sans option render, le rendu n'est jamais appelé", async () => {
  delete process.env.M3_RENDER_FALLBACK;
  const { renderer, calls } = stubRenderer({ [LIST]: listPage(2), ...articles(2) });
  const r = await withFetch({ [LIST]: SPA }, () => harvestArticleList(LIST, { renderer }));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(r.diag.render, undefined);
});

test("repli désactivé : une source qui marche donne le même résultat qu'avant", async () => {
  const { renderer, calls } = stubRenderer({});
  const pages = { [LIST]: listPage(2), ...articles(2) };
  const off = await withFetch(pages, () => harvestArticleList(LIST, { render: false, renderer }));
  const on = await withFetch(pages, () => harvestArticleList(LIST, { render: true, renderer }));
  assert.equal(off.items.length, 2);
  assert.deepEqual(on, off);
  assert.equal(calls.length, 0);
});

test("repli activé : 0 article statique → la page liste et ses articles passent par le rendu", async () => {
  /* Liens présents mais articles vides en statique (contenu chargé par JS) */
  const thin = Object.fromEntries(Object.keys(articles(2)).map((u) => [u, "<html><body><article></article></body></html>"]));
  const { renderer, calls } = stubRenderer({ [LIST]: listPage(2), ...articles(2) });
  const r = await withFetch({ [LIST]: listPage(2), ...thin }, () => harvestArticleList(LIST, { render: true, renderer }));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2);
  assert.equal(r.diag.via, "rendered");
  assert.equal(r.diag.render, "no-items");
  assert.equal(r.diag.staticDiag.thin, 2);
  assert.equal(calls[0], LIST);
});

test("repli activé : page JS → rendu", async () => {
  const { renderer } = stubRenderer({ [LIST]: listPage(3), ...articles(3) });
  const r = await withFetch({ [LIST]: SPA }, () => harvestArticleList(LIST, { render: true, renderer, maxItems: 2 }));
  assert.equal(r.items.length, 2);
  assert.equal(r.diag.render, "js");
});

test("repli activé : articles déjà vus → pas de rendu (rien de nouveau n'est un succès)", async () => {
  const { renderer, calls } = stubRenderer({});
  const r = await withFetch({ [LIST]: listPage(2), ...articles(2) }, () =>
    harvestArticleList(LIST, { render: true, renderer, isSeen: () => true }));
  assert.equal(r.items.length, 0);
  assert.equal(calls.length, 0);
});

test("repli activé : échec du rendu → résultat statique, cause dans diag.render", async () => {
  const { renderer } = stubRenderer({});
  const r = await withFetch({ [LIST]: SPA }, () => harvestArticleList(LIST, { render: true, renderer }));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 0);
  assert.match(r.diag.render, /^js : HTTP 404/);
});

test("repli désactivé : un 403 reste une erreur, sans rendu", async () => {
  const { renderer, calls } = stubRenderer({ [LIST]: listPage(2), ...articles(2) });
  const r = await withFetch({ [LIST]: 403 }, () => harvestArticleList(LIST, { render: false, renderer }));
  assert.deepEqual(r, { ok: false, error: "HTTP 403", items: [] });
  assert.equal(calls.length, 0);
});

test("repli activé : page liste en 403 → rendu de la liste et des articles", async () => {
  const { renderer, calls } = stubRenderer({ [LIST]: listPage(2), ...articles(2) });
  const r = await withFetch({ [LIST]: 403 }, () => harvestArticleList(LIST, { render: true, renderer }));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2);
  assert.equal(r.diag.via, "rendered");
  assert.equal(r.diag.render, "http-403");
  assert.equal(calls.length, 3);
});

test("repli activé : 403 aussi dans le navigateur → échec, les deux causes gardées", async () => {
  const { renderer } = stubRenderer({ [LIST]: 403 });
  const r = await withFetch({ [LIST]: 403 }, () => harvestArticleList(LIST, { render: true, renderer }));
  assert.equal(r.ok, false);
  assert.equal(r.error, "HTTP 403 (repli : HTTP 403)");
});

test("repli activé : autre erreur HTTP (503) → pas de rendu", async () => {
  const { renderer, calls } = stubRenderer({ [LIST]: listPage(2) });
  const r = await withFetch({ [LIST]: 503 }, () => harvestArticleList(LIST, { render: true, renderer }));
  assert.equal(r.error, "HTTP 503");
  assert.equal(calls.length, 0);
});

test("réglage harvest_render_fallback : crawlers choisis, et M3_RENDER_FALLBACK=0 coupe tout", () => {
  assert.equal(rendererFor(undefined, {}), null);
  assert.equal(rendererFor("non", {}), null);
  assert.deepEqual(rendererFor("playwright", {}), { render: fetchRendered, stealth: null });
  assert.deepEqual(rendererFor("furtif", {}), { render: fetchRendered, stealth: fetchStealth });
  assert.equal(rendererFor("playwright", { M3_RENDER_FALLBACK: "0" }), null);
  assert.equal(rendererFor("furtif", { M3_RENDER_FALLBACK: "0" }), null);
});

/* Furtif (M3-57) : retenté seulement sur un 403, résultat « ok » ou « refus » pour harvestRun. */
test("furtif : 403 → crawler furtif, la source se lit → furtif « ok »", async () => {
  const { renderer: stealth, calls } = stubRenderer({ [LIST]: listPage(2), ...articles(2) });
  const { renderer, calls: renderCalls } = stubRenderer({});
  const r = await withFetch({ [LIST]: 403 }, () => harvestArticleList(LIST, { render: true, renderer, stealth }));
  assert.equal(r.ok, true);
  assert.equal(r.furtif, "ok");
  assert.equal(r.items.length, 2);
  assert.equal(r.diag.via, "furtif");
  assert.equal(calls[0], LIST);
  assert.equal(renderCalls.length, 0, "le rendu sans camouflage n'est pas tenté en plus");
});

test("furtif : 403 → furtif refusé, ou page sans article → furtif « refus »", async () => {
  const refuse = stubRenderer({ [LIST]: 403 }).renderer;
  const r1 = await withFetch({ [LIST]: 403 }, () => harvestArticleList(LIST, { render: true, stealth: refuse }));
  assert.deepEqual([r1.ok, r1.furtif, r1.error], [false, "refus", "HTTP 403 (furtif : HTTP 403)"]);

  const muette = stubRenderer({ [LIST]: SPA }).renderer;
  const r2 = await withFetch({ [LIST]: 403 }, () => harvestArticleList(LIST, { render: true, stealth: muette }));
  assert.deepEqual([r2.ok, r2.furtif], [false, "refus"]);
});

test("furtif : source en liste blanche → furtif direct, sans requête ordinaire", async () => {
  const { renderer: stealth, calls } = stubRenderer({ [LIST]: listPage(1), ...articles(1) });
  const r = await withFetch({}, async (net) => {
    const res = await harvestArticleList(LIST, { render: true, stealth, stealthFirst: true });
    assert.equal(net.calls.length, 0, "aucun fetch ordinaire");
    return res;
  });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.diag.furtif, "liste");
  assert.equal(r.furtif, undefined, "pas de nouvelle inscription");
  assert.equal(calls.length, 2);
});

test("furtif : pas sur les autres causes (page JS, 503)", async () => {
  const { renderer: stealth, calls } = stubRenderer({ [LIST]: listPage(2), ...articles(2) });
  const { renderer } = stubRenderer({ [LIST]: listPage(2), ...articles(2) });
  const js = await withFetch({ [LIST]: SPA }, () => harvestArticleList(LIST, { render: true, renderer, stealth }));
  assert.equal(js.diag.via, "rendered");
  const err = await withFetch({ [LIST]: 503 }, () => harvestArticleList(LIST, { render: true, renderer, stealth }));
  assert.equal(err.error, "HTTP 503");
  assert.equal(calls.length, 0);
});

/* T6 — furtif robuste. */
test("T6 : un crawler qui ne rend pas la main est arrêté au délai, et démonté (navigateur fermé)", async () => {
  const seen = { aborted: false, torn: false };
  const lib = {
    Configuration: class {},
    PlaywrightCrawler: class {
      constructor() { this.autoscaledPool = { abort: () => { seen.aborted = true; } }; }
      run() { return new Promise(() => {}); }
      async teardown() { seen.torn = true; }
    },
  };
  const t0 = Date.now();
  await assert.rejects(fetchStealth(LIST, { lib, hardMs: 50 }), /délai dépassé/);
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(seen, { aborted: true, torn: true });
});

test("T6 : crawler en erreur → démonté quand même", async () => {
  let torn = false;
  const lib = { Configuration: class {}, PlaywrightCrawler: class { async run() { throw new Error("boum"); } async teardown() { torn = true; } } };
  await assert.rejects(fetchStealth(LIST, { lib, hardMs: 1000 }), /boum/);
  assert.equal(torn, true);
});

/* Faux playwright-core, à la forme de la vraie API : launchServer() rend un
   BrowserServer (wsEndpoint, kill, process) ; connect() rend un Browser, SANS
   process(). Chaque goto attend qu'on le libère (st.pending). */
function fakePlaywright({ hangLaunch = false } = {}) {
  const st = { browserClosed: 0, serverKilled: 0, ctxClosed: 0, pending: [], releaseLaunch: null };
  const browser = {
    newContext: async () => ({
      newPage: async () => ({
        route: async () => {},
        goto: () => new Promise((r) => st.pending.push(() => r({ status: () => 200 }))),
        content: async () => "<html></html>",
      }),
      close: async () => { st.ctxClosed++; },
    }),
    close: async () => { st.browserClosed++; },
  };
  const server = { wsEndpoint: () => "ws://127.0.0.1:1/x", kill: async () => { st.serverKilled++; }, process: () => ({ kill: () => {} }) };
  const lib = { chromium: {
    launchServer: () => (hangLaunch ? new Promise((r) => { st.releaseLaunch = () => r(server); }) : Promise.resolve(server)),
    connect: async () => browser,
  } };
  return { lib, st };
}
const until = async (cond) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 5)); };

test("T6 : closeRenderer pendant un rendu en cours ne ferme pas le navigateur ; il le ferme (et tue le serveur) à la fin", async () => {
  await closeRenderer();
  const { lib, st } = fakePlaywright();
  const run = fetchRendered(LIST, { lib, hardMs: 5000 });
  await until(() => st.pending.length === 1);
  await closeRenderer();
  assert.deepEqual([st.browserClosed, st.serverKilled], [0, 0], "pas sous l'appel en cours");
  st.pending[0]();
  assert.equal(await run, "<html></html>");
  await until(() => st.serverKilled === 1);
  assert.deepEqual([st.browserClosed, st.serverKilled], [1, 1], "fermé puis serveur tué, une fois le dernier appel terminé");
});

test("T6 : rendu bloqué → délai dépassé ; seul son contexte est fermé, le navigateur prêt n'est pas tué", async () => {
  await closeRenderer();
  const { lib, st } = fakePlaywright();
  await assert.rejects(fetchRendered(LIST, { lib, hardMs: 50 }), /délai dépassé/);
  assert.deepEqual([st.ctxClosed, st.browserClosed, st.serverKilled], [1, 0, 0]);
  await closeRenderer();
  assert.equal(st.serverKilled, 1);
});

test("T6 : deux rendus concurrents — l'un dépasse son délai, l'autre finit normalement sur le même navigateur", async () => {
  await closeRenderer();
  const { lib, st } = fakePlaywright();
  const slow = fetchRendered(LIST, { lib, hardMs: 50 });
  const ok = fetchRendered(LIST, { lib, hardMs: 5000 });
  await until(() => st.pending.length === 2);
  await assert.rejects(slow, /délai dépassé/);
  assert.deepEqual([st.browserClosed, st.serverKilled], [0, 0], "le délai d'un appel ne tue pas le navigateur partagé");
  st.pending[1]();
  assert.equal(await ok, "<html></html>");
  assert.equal(st.ctxClosed, 2);
  await closeRenderer();
  assert.equal(st.serverKilled, 1);
});

test("T6 : launchServer() qui ne rend pas la main → délai ; l'appel suivant n'est pas bloqué ; le serveur tardif est tué", async () => {
  await closeRenderer();
  const hung = fakePlaywright({ hangLaunch: true });
  await assert.rejects(fetchRendered(LIST, { lib: hung.lib, hardMs: 50 }), /délai dépassé/);

  const { lib, st } = fakePlaywright();
  const run = fetchRendered(LIST, { lib, hardMs: 5000 });
  await until(() => st.pending.length === 1);
  st.pending[0]();
  assert.equal(await run, "<html></html>", "pas bloqué derrière le lancement gelé");

  hung.st.releaseLaunch();
  await until(() => hung.st.serverKilled === 1);
  assert.equal(hung.st.serverKilled, 1, "le lancement abandonné est tué à son arrivée (BrowserServer.kill)");
  await closeRenderer();
});

test("T6 : liste blanche recontrôlée, le fetch ordinaire passe → récolte normale, furtif « sortie »", async () => {
  const { renderer: stealth, calls } = stubRenderer({});
  const r = await withFetch({ [LIST]: listPage(2), ...articles(2) }, () =>
    harvestArticleList(LIST, { stealth, stealthFirst: true, stealthRecheck: true }));
  assert.equal(r.ok, true);
  assert.equal(r.furtif, "sortie");
  assert.equal(r.items.length, 2);
  assert.equal(calls.length, 0, "pas de furtif");
});

test("T6 : liste blanche recontrôlée, toujours 403 → furtif comme avant", async () => {
  const { renderer: stealth } = stubRenderer({ [LIST]: listPage(1), ...articles(1) });
  const r = await withFetch({ [LIST]: 403 }, () => harvestArticleList(LIST, { stealth, stealthFirst: true, stealthRecheck: true }));
  assert.equal(r.ok, true);
  assert.equal(r.diag.furtif, "liste");
  assert.equal(r.furtif, undefined);
});

test("T6 : source en liste blanche, furtif en échec ou sans rien de lisible → « refus »", async () => {
  const refuse = stubRenderer({ [LIST]: 403 }).renderer;
  const r1 = await withFetch({}, () => harvestArticleList(LIST, { stealth: refuse, stealthFirst: true }));
  assert.deepEqual([r1.ok, r1.furtif], [false, "refus"]);
  const muette = stubRenderer({ [LIST]: SPA }).renderer;
  const r2 = await withFetch({}, () => harvestArticleList(LIST, { stealth: muette, stealthFirst: true }));
  assert.deepEqual([r2.ok, r2.furtif], [false, "refus"]);
});



test("M3-116 : appels en attente d'un lancement abandonné → une nouvelle tentative sur un lancement neuf, réussie", async () => {
  await closeRenderer();
  const { lib, st } = fakeChromium({ hang: [0] });
  const slow = fetchRendered(LIST, { lib, hardMs: 50 });
  const waiting = [fetchRendered(LIST, { lib, hardMs: 5000 }), fetchRendered(LIST, { lib, hardMs: 5000 })];
  await assert.rejects(slow, /délai dépassé/, "l'appel dont le délai a abandonné le lancement échoue");
  await until(() => st.pending.length === 2);
  assert.equal(st.launches, 2, "un seul lancement neuf pour les deux appels retentés");
  st.pending.forEach((go) => go());
  assert.deepEqual(await Promise.all(waiting), ["<html>0</html>", "<html>1</html>"]);
  st.release[0]();
  await until(() => st.killed.includes(0));
  assert.ok(st.killed.includes(0), "le lancement abandonné est tué à son arrivée");
  await closeRenderer();
});

test("M3-116 : un lancement neuf qui échoue aussi → pas de troisième tentative", async () => {
  await closeRenderer();
  const { lib, st } = fakeChromium({ hang: [0, 1] });
  const slow = fetchRendered(LIST, { lib, hardMs: 50 });
  const waiting = fetchRendered(LIST, { lib, hardMs: 100 });
  await assert.rejects(slow, /délai dépassé/);
  await assert.rejects(waiting, /délai dépassé/);
  assert.equal(st.launches, 2);
  st.release[0](); st.release[1]();
  await until(() => st.killed.length === 2);
  await closeRenderer();
});

test("M3-116 : ctx.close() gelé avec inUse > 1 → les appels voisins sont retentés une fois", async () => {
  await closeRenderer();
  const { lib, st } = fakeChromium({ hangCtxClose: [0] });
  const first = fetchRendered(LIST, { lib, hardMs: 30000 });
  const neighbour = fetchRendered(LIST, { lib, hardMs: 30000 });
  await until(() => st.pending.length === 2);
  st.pending[0]();
  /* Le contexte 0 ne se ferme pas : au bout de CLOSE_MS (10 s), navigateur abandonné. */
  assert.equal(await first, "<html>0</html>", "le résultat déjà obtenu est rendu");
  await until(() => st.pending.length === 3);
  assert.equal(st.launches, 2, "le voisin est retenté sur un lancement neuf");
  st.pending[2]();
  assert.equal(await neighbour, "<html>2</html>");
  await until(() => st.killed.includes(0));
  assert.ok(st.killed.includes(0), "le navigateur gelé est tué");
  await closeRenderer();
}, { timeout: 30000 });

test("M3-116 : furtif — un lancement arrivé après le démontage est tué aussitôt", async () => {
  const { lib: pw, st } = fakeChromium({ hang: [0] });
  let launching;
  const lib = {
    Configuration: class {},
    PlaywrightCrawler: class {
      constructor(options) { this.options = options; }
      run() { launching = this.options.launchContext.launcher.launch({}); return new Promise(() => {}); }
      async teardown() {}
    },
  };
  await assert.rejects(fetchStealth(LIST, { lib, pw, hardMs: 50 }), /délai dépassé/);
  assert.deepEqual(st.killed, []);
  st.release[0]();
  await assert.rejects(launching, /rendu abandonné/);
  assert.deepEqual(st.killed, [0]);
});
