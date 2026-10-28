/* Rendu d'une page par un Chromium headless — repli de la récolte des pages
   « liste » quand le HTML statique ne donne rien (M3-57, docs/plans/scraping-M3-57.md).

   - Désactivé par défaut. Le réglage harvest_render_fallback (section FEAT des
     Paramètres) choisit : « non », « playwright » ou « furtif ».
     `M3_RENDER_FALLBACK=0` est le coupe-circuit d'exploitation : il force « non »
     quel que soit le réglage, liste blanche du furtif comprise (rendererFor).
   - Les modules sont chargés à la demande (`playwright-core`, `crawlee`) : absents,
     le repli échoue proprement, cause au diagnostic de la source.
   - fetchRendered, sans camouflage : même agent utilisateur que fetchCapped. Un
     statut HTTP ≥ 400 dans le navigateur est une erreur (« HTTP 403 » comme net.js).
   - fetchStealth (« furtif », décision de l'utilisateur du 2026-10-26) : crawlee et
     ses empreintes de navigateur générées, c'est-à-dire un CONTOURNEMENT des
     protections anti-robot. Seulement sur un 403, puis sur la liste blanche
     automatique des sources où il a réussi (harvestRun).
   - Un seul navigateur pour toute la récolte, fermé par closeRenderer() en fin de run,
     ou seul après IDLE_MS sans usage (le bouton « tester la source » n'a pas de fin de run). */

import { UA } from "./net.js";

const MAX_BYTES = 2 * 1024 * 1024;
const IDLE_MS = 60_000;
/* Fermeture d'un contexte, d'un navigateur ou d'un crawler : au-delà, il est jugé gelé. */
const CLOSE_MS = 10_000;

/* Crawlers de repli pour une valeur du réglage : { render, stealth }, ou null
   (repli coupé). « furtif » garde le rendu sans camouflage pour les pages JS et
   n'emploie le camouflage que sur les 403. */
export function rendererFor(mode, env = process.env) {
  if (env.M3_RENDER_FALLBACK === "0") return null;
  if (mode === "playwright") return { render: fetchRendered, stealth: null };
  if (mode === "furtif") return { render: fetchRendered, stealth: fetchStealth };
  return null;
}

/* Spécificateur en variable et ignoré du bundler : sans la dépendance installée,
   le build Next ne doit pas chercher à la résoudre. */
async function load(mod) {
  try {
    return await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ mod);
  } catch {
    throw new Error(`rendu indisponible (${mod} absent)`);
  }
}

/* Délai maximal autour d'une opération qui peut ne jamais rendre la main (un
   crawler ou un Chromium bloqué) : au-delà, `onTimeout` nettoie et l'appel échoue. */
function withDeadline(work, ms, onTimeout) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      Promise.resolve(onTimeout?.()).catch(() => {});
      reject(new Error(`délai dépassé (${Math.round(ms / 1000)} s)`));
    }, ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/* Lanceur donné à crawlee à la place de playwright.chromium : chaque navigateur
   passe par launchServer(), qui seul expose un vrai kill(). Crawlee n'appelle que
   name() et launch() (pages incognito : jamais launchPersistentContext, qui lance
   en plus un navigateur « de version » que personne ne tue). Les serveurs lancés
   sont ajoutés à `servers` ; un lancement arrivé après `servers.done` est tué aussitôt.
   `pw` : playwright-core, chargé au premier lancement. */
function killableLauncher(pw, servers) {
  return {
    name: () => "chromium",
    async launch(options) {
      const mod = pw || await load("playwright-core");
      const chromium = mod.chromium || mod.default.chromium;
      const server = await chromium.launchServer(options);
      if (servers.done) { await killServer(server); throw new Error("rendu abandonné"); }
      servers.push(server);
      return chromium.connect(server.wsEndpoint());
    },
  };
}

/* Tue un serveur de navigateur : BrowserServer.kill borné, puis SIGKILL sur son processus. */
async function killServer(server) {
  try { await withDeadline(server.kill(), CLOSE_MS); } catch {
    try { server.process()?.kill("SIGKILL"); } catch { /* déjà mort */ }
  }
}

/* HTML d'une page via crawlee (empreintes générées), un crawler par appel :
   10 à 40 s par page mesurées le 2026-10-26. Throw si refusée ou inaccessible.
   Borné à `hardMs` (M3-57, T6) ; le crawler est démonté dans tous les cas. Son
   démontage ne fait que browser.close() (PlaywrightController._kill) : un Chromium
   gelé y survivrait. Les navigateurs sont donc lancés par killableLauncher et
   tués après le démontage (M3-116), qu'il ait abouti ou non.
   `lib` : le module crawlee, `pw` : playwright-core (injection pour les tests). */
export async function fetchStealth(url, { timeoutMs = 15000, maxBytes = MAX_BYTES, hardMs = timeoutMs + 30000, lib = null, pw = null } = {}) {
  const { PlaywrightCrawler, Configuration } = lib || await load("crawlee");
  const servers = [];
  let out = { error: "aucune réponse" };
  const crawler = new PlaywrightCrawler({
    maxRequestRetries: 0,
    headless: true,
    launchContext: {
      launcher: killableLauncher(pw, servers),
      useIncognitoPages: true,
    },
    navigationTimeoutSecs: Math.ceil(timeoutMs / 1000),
    requestHandlerTimeoutSecs: Math.ceil(timeoutMs / 1000) + 10,
    async requestHandler({ page, response }) {
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const status = response ? response.status() : null;
      out = status != null && status < 400 ? { html: await page.content() } : { error: `HTTP ${status}` };
    },
    failedRequestHandler({ request }) {
      out = { error: (request.errorMessages || []).slice(-1)[0]?.split("\n")[0] || "échec" };
    },
  }, new Configuration({ persistStorage: false, purgeOnStart: true }));
  try {
    await withDeadline(crawler.run([{ url, uniqueKey: `${url}#${Date.now()}` }]), hardMs,
      () => crawler.autoscaledPool?.abort());
  } finally {
    /* Borné lui aussi : un Chromium gelé ferait sinon attendre sans fin. */
    await withDeadline(Promise.resolve(crawler.teardown?.()), CLOSE_MS).catch(() => {});
    /* Déjà fermés par le démontage : kill() ne fait rien. Gelés : ils meurent ici. */
    servers.done = true;
    await Promise.all(servers.map(killServer));
  }
  if (out.error) throw new Error(out.error);
  if (Buffer.byteLength(out.html) > maxBytes) throw new Error("réponse trop volumineuse");
  return out.html;
}

/* Navigateur partagé du rendu sans camouflage, lancé par launchServer() : seul
   BrowserServer donne un vrai kill() (le Browser de Playwright n'expose pas son
   processus). `inUse` compte les appels en cours : ni le minuteur d'inactivité ni
   closeRenderer ne le ferment sous l'un d'eux (T6) ; une fermeture demandée
   pendant un appel attend le dernier.
   Un appel en retard ne tue pas le navigateur des autres : il ferme seulement son
   contexte. Le navigateur n'est abandonné (et tué, même s'il arrive plus tard) que
   si son lancement est encore en cours, ou s'il ne répond plus à la fermeture
   d'un contexte. L'appel suivant en lance alors un neuf, et les appels qui
   l'attendaient ou s'en servaient sont réveillés (`gone`) et retentés une fois sur
   un lancement neuf (M3-116). */
let shared = null; // { p: Promise<{ server, browser }>, ready, abandoned, gone }
let idle = null;
let inUse = 0;
let closeWanted = false;

function launch(lib) {
  if (!shared) {
    const s = { ready: false, abandoned: false };
    s.gone = new Promise((_, reject) => { s.fail = reject; });
    s.gone.catch(() => {});
    s.p = (async () => {
      const pw = lib || await load("playwright-core");
      const chromium = pw.chromium || pw.default.chromium;
      const server = await chromium.launchServer({ headless: true });
      try {
        const browser = await chromium.connect(server.wsEndpoint());
        s.ready = true;
        return { server, browser };
      } catch (err) {
        await server.kill().catch(() => {});
        throw err;
      }
    })();
    s.p.catch(() => { if (shared === s) shared = null; });
    shared = s;
  }
  return shared;
}

/* Fermeture bornée ; un navigateur qui ne se ferme pas est tué (BrowserServer.kill,
   puis SIGKILL sur son processus). */
async function killBrowser({ server, browser }) {
  try { await withDeadline(browser.close(), CLOSE_MS); } catch { /* gelé : on tue */ }
  await killServer(server);
}

/* Abandonne ce navigateur : les appels qui l'attendent ou s'en servent sont
   réveillés par `gone`, il est tué dès qu'il existe. Une seule fois. */
function abandon(s) {
  if (s.abandoned) return;
  s.abandoned = true;
  if (shared === s) shared = null;
  s.fail(new Error("navigateur abandonné"));
  s.p.then(killBrowser, () => {});
}

function release() {
  inUse--;
  if (inUse > 0) return;
  if (closeWanted) { closeRenderer(); return; }
  clearTimeout(idle);
  idle = setTimeout(closeRenderer, IDLE_MS);
  idle.unref?.();
}

/* HTML de la page après exécution de son JavaScript ; throw si inaccessible.
   Borné à `hardMs` (lancement du navigateur compris) par tentative. Si le
   navigateur est abandonné sous l'appel par un autre (lancement trop long,
   contexte gelé), une seule nouvelle tentative sur un lancement neuf : au pire
   2 × hardMs. `lib` : le module playwright-core (injection pour les tests). */
export async function fetchRendered(url, { timeoutMs = 15000, maxBytes = MAX_BYTES, hardMs = timeoutMs + 30000, lib = null } = {}) {
  clearTimeout(idle);
  inUse++;
  try {
    try {
      return await renderOn(launch(lib), url, { timeoutMs, maxBytes, hardMs });
    } catch (err) {
      if (!err.retry) throw err;
      return await renderOn(launch(lib), url, { timeoutMs, maxBytes, hardMs });
    }
  } finally {
    release();
  }
}

/* Une tentative sur le navigateur `s`. L'erreur porte `retry` si `s` a été
   abandonné pendant l'appel sans que son propre délai soit en cause. */
async function renderOn(s, url, { timeoutMs, maxBytes, hardMs }) {
  let ctx = null;
  let late = false;
  let timedOut = false;
  try {
    const work = (async () => {
      const { browser } = await s.p;
      const c = await browser.newContext({ userAgent: UA, javaScriptEnabled: true });
      /* Contexte arrivé après le délai ou l'abandon : personne ne le fermera plus, on le ferme ici. */
      if (late || s.abandoned) { c.close().catch(() => {}); throw new Error("rendu abandonné"); }
      ctx = c;
      const page = await ctx.newPage();
      /* Ni images ni polices ni médias : seul le DOM nous intéresse. */
      await page.route("**/*", (route) => {
        const t = route.request().resourceType();
        return ["image", "font", "media"].includes(t) ? route.abort() : route.continue();
      });
      const res = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
      if (!res) throw new Error("rendu : aucune réponse");
      if (res.status() >= 400) throw new Error(`HTTP ${res.status()}`);
      const html = await page.content();
      if (Buffer.byteLength(html) > maxBytes) throw new Error("réponse trop volumineuse");
      return html;
    })();
    return await withDeadline(Promise.race([work, s.gone]), hardMs, () => {
      late = true;
      timedOut = true;
      /* Lancement encore en cours : c'est lui qui bloque, il est abandonné. Sinon
         le navigateur sert peut-être à d'autres : seul notre contexte est fermé. */
      if (!s.ready) abandon(s);
    });
  } catch (err) {
    if (s.abandoned && !timedOut) err.retry = true;
    throw err;
  } finally {
    late = true;
    /* Un contexte qui ne se ferme pas : le navigateur ne répond plus, il est
       abandonné. Déjà abandonné : il est tué, inutile d'attendre son contexte. */
    if (ctx && !s.abandoned) await withDeadline(ctx.close(), CLOSE_MS).catch(() => abandon(s));
  }
}

/* Ferme le navigateur partagé, ou, si un rendu est en cours, dès qu'il finit.
   Bornée : un lancement resté pendant ne la bloque pas, il sera tué à l'arrivée. */
export async function closeRenderer() {
  clearTimeout(idle);
  if (inUse > 0) { closeWanted = true; return; }
  closeWanted = false;
  const s = shared;
  shared = null;
  if (!s) return;
  await withDeadline(s.p.then(killBrowser, () => {}), 2 * CLOSE_MS + 1000).catch(() => {});
}
