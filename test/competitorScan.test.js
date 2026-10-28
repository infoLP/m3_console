/* M3-121 (T11) — scan des concurrents (src/ingest/competitorScan.js) et garde SSRF
   (src/ingest/safeFetch.js). Base simulée par un dépôt en mémoire, réseau par un
   `fetcher` injecté ; le crawl est le vrai (competitorCandidates). Le branchement
   à l'ordonnanceur est dans scheduleWiring.test.js. */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createCompetitorScan, ARTICLES_MAX, SCAN_LOCK, LAST_SCAN_KEY } from "../src/ingest/competitorScan.js";
import { competitorCandidates } from "../src/ingest/concurrents.js";
import { refusedHost, refusedUrl, safeFetcher } from "../src/ingest/safeFetch.js";
import { safeGet } from "../src/publish/safeGet.js";

const SITE = "https://www.concurrent.fr";
const LIST = `${SITE}/actualites`;
const art = (n) => `${LIST}/2026/10/un-article-numero-${n}-sur-le-sujet`;
const article = (links) =>
  `<html><head><title>Un titre d'article assez long pour passer</title><meta property="article:published_time" content="2026-10-20T08:00:00Z"></head>` +
  `<body><article><h1>Un titre d'article assez long pour passer</h1><p>${"Texte de l'article. ".repeat(20)}</p>` +
  `${links.map((u) => `<a href="${u}">lien</a>`).join(" ")}</article></body></html>`;
const listPage = (ns) => `<html><body><main>${ns.map((n) =>
  `<a href="${art(n)}">Un article numéro ${n} sur le sujet du jour</a>`).join("")}</main></body></html>`;

/* Réseau simulé : url → texte, ou nombre (statut HTTP d'erreur). */
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

/* Dépôt en mémoire, mêmes méthodes que pgRepo. */
function memRepo({ competitors = [], sources = [] } = {}) {
  const cands = new Map();
  const scans = new Map();
  let seq = 0;
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 27, 10, 0, clock++)).toISOString();
  return {
    cands, scans,
    seed(row) { cands.set(row.domain, { id: ++seq, status: "nouveau", occurrences: 0, competitors: [], articles: [], first_seen_at: stamp(), last_seen_at: stamp(), decided_by: null, decided_at: null, ...row }); },
    activeCompetitors: async () => competitors.filter((c) => c.active !== false),
    allCompetitorUrls: async () => competitors.map((c) => c.url),
    knownUrls: async () => sources,
    candidate: async (d) => (cands.has(d) ? structuredClone(cands.get(d)) : null),
    saveCandidate: async (c) => {
      const e = cands.get(c.domain);
      if (e) cands.set(c.domain, { ...e, ...structuredClone(c), last_seen_at: stamp() });
      else { const t = stamp(); cands.set(c.domain, { id: ++seq, status: "nouveau", first_seen_at: t, last_seen_at: t, decided_by: null, decided_at: null, ...structuredClone(c) }); }
    },
    scanned: async (id, s) => { scans.set(Number(id), s); },
    listCandidates: async ({ status, limit }) => [...cands.values()].filter((c) => !status || c.status === status)
      .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at)).slice(0, limit),
    setCandidateStatus: async (id, status, by) => {
      const c = [...cands.values()].find((x) => x.id === id);
      if (!c) return null;
      Object.assign(c, { status, decided_by: status === "nouveau" ? null : by, decided_at: status === "nouveau" ? null : stamp() });
      return structuredClone(c);
    },
  };
}

/* Bail, réglages et kv en mémoire ; crawl réel sans attente entre requêtes. */
function setup({ competitors, sources = [], pages = {}, settings = {}, refused, crawlFails = [] } = {}) {
  const repo = memRepo({ competitors, sources });
  const kv = new Map();
  const locks = new Map();
  const lockCalls = [];
  const notes = [];
  const { fetcher, calls } = net(pages);
  const crawled = [];
  const scan = createCompetitorScan({
    repo,
    fetcher,
    crawl: async (url, opts) => {
      crawled.push(url);
      if (crawlFails.includes(url)) throw new Error("plantage du crawl");
      return competitorCandidates(url, { ...opts, sleep: async () => {} });
    },
    ...(refused ? { refused } : { refused: async () => null }),
    lock: {
      acquire: async (name, { owner }) => { lockCalls.push(name); if (locks.has(name)) return null; locks.set(name, { owner, since: "2026-10-27T10:00:00.000Z" }); return "jeton"; },
      release: async (name) => { locks.delete(name); },
      holder: async (name) => locks.get(name) || null,
    },
    settings: async () => settings,
    store: {
      readJson: async (k, fb = null) => (kv.has(k) ? structuredClone(kv.get(k)) : fb),
      writeJson: async (k, v) => { kv.set(k, structuredClone(v)); },
      pushCollection: async (name, item) => { const a = kv.get(name) || []; a.unshift(item); kv.set(name, a); },
    },
    note: (...a) => { notes.push(a); },
    now: () => Date.parse("2026-10-27T10:00:00Z"),
  });
  return { scan, repo, kv, locks, lockCalls, notes, calls, crawled };
}

const C1 = { id: 1, label: "Le Concurrent", url: LIST };
const C2 = { id: 2, label: "Hors service", url: "https://www.en-panne.fr/actus" };
const C3 = { id: 3, label: "Plantage", url: "https://www.plante.fr/actus" };

function pagesFor(ns, linksOf) {
  const pages = { [`${SITE}/robots.txt`]: "", [LIST]: listPage(ns), "https://www.en-panne.fr/robots.txt": 503 };
  for (const n of ns) pages[art(n)] = article(linksOf(n));
  return pages;
}

test("critère 2 : candidats upsertés, référentiel ignoré, statut écarté conservé, articles bornés ; last_scan_* et erreurs isolées", async () => {
  const links = { 1: ["https://www.inconnu.fr/a", "https://deja-connu.fr/x"], 2: ["https://inconnu.fr/b", "https://ecarte.fr/c"] };
  const t = setup({
    competitors: [C1, C2, C3, { id: 4, label: "Inactif", url: "https://inactif.fr", active: false }],
    sources: ["https://www.deja-connu.fr/", null, "https://flux.autre.fr/rss"].filter(Boolean),
    pages: pagesFor([1, 2], (n) => links[n]),
    crawlFails: [C3.url],
  });
  const old = Array.from({ length: ARTICLES_MAX }, (_, i) => ({ url: `https://vieux.fr/${i}`, title: "", competitorId: 9 }));
  t.repo.seed({ domain: "ecarte.fr", status: "ecarte", occurrences: 3, competitors: [{ id: 9, label: "Ancien" }], articles: old, decided_by: "admin" });

  const last = await t.scan.runCompetitorScan({ trigger: "manuel", by: "Camille" });
  assert.deepEqual(last, { at: "2026-10-27T10:00:00.000Z", trigger: "manuel", by: "Camille", competitors: 3, errors: 2, candidates: 1 });
  assert.deepEqual(t.crawled, [C1.url, C2.url, C3.url], "inactif non crawlé ; une erreur n'arrête pas les suivants");

  assert.ok(!t.repo.cands.has("deja-connu.fr"), "domaine du référentiel ignoré");
  const inconnu = t.repo.cands.get("inconnu.fr");
  assert.equal(inconnu.occurrences, 2);
  assert.deepEqual(inconnu.competitors, [{ id: 1, label: "Le Concurrent" }]);
  assert.deepEqual(inconnu.articles.map((a) => [a.url, a.competitorId]), [[art(1), 1], [art(2), 1]]);

  const ecarte = t.repo.cands.get("ecarte.fr");
  assert.equal(ecarte.status, "ecarte", "statut décidé conservé");
  assert.equal(ecarte.decided_by, "admin");
  assert.equal(ecarte.occurrences, 4, "occurrences cumulées");
  assert.equal(ecarte.articles.length, ARTICLES_MAX, "articles bornés");
  assert.equal(ecarte.articles[0].url, art(2), "le plus récent en tête");
  assert.deepEqual(ecarte.competitors.map((c) => c.id), [9, 1], "concurrents fusionnés");

  assert.deepEqual(t.repo.scans.get(1), { status: "ok", via: "page", error: null });
  assert.equal(t.repo.scans.get(2).status, "erreur");
  assert.match(t.repo.scans.get(2).error, /robots\.txt injoignable : HTTP 503/);
  assert.deepEqual(t.repo.scans.get(3), { status: "erreur", via: null, error: "plantage du crawl" });
  assert.equal(t.repo.scans.has(4), false);
  assert.deepEqual(t.kv.get(LAST_SCAN_KEY), last);
  assert.equal(t.notes[0][0], "chaine");
  assert.equal(t.notes[0][2].level, "warn");
});

test("critère 2 : un article déjà vu ne recompte pas, un nouvel article cumule", async () => {
  const links = { 1: ["https://inconnu.fr/a"], 2: ["https://inconnu.fr/b"], 3: ["https://inconnu.fr/c", "https://inconnu.fr/d"] };
  const pages = pagesFor([1, 2], (n) => links[n]);
  const t = setup({ competitors: [C1], pages });
  await t.scan.runCompetitorScan({ trigger: "planifie" });
  assert.equal(t.repo.cands.get("inconnu.fr").occurrences, 2);

  const again = await t.scan.runCompetitorScan({ trigger: "planifie" });
  assert.equal(t.repo.cands.get("inconnu.fr").occurrences, 2, "mêmes articles : rien de plus");
  assert.equal(again.candidates, 0);

  Object.assign(pages, { [LIST]: listPage([3, 1, 2]), [art(3)]: article(links[3]) });
  await t.scan.runCompetitorScan({ trigger: "planifie" });
  assert.equal(t.repo.cands.get("inconnu.fr").occurrences, 4);
  assert.equal(t.repo.cands.get("inconnu.fr").articles[0].url, art(3));
});

test("critère 5 : une notification si de nouveaux candidats (nombre, 3 premiers domaines, déclencheur), aucune sinon", async () => {
  const links = { 1: ["https://a.fr/1", "https://b.fr/1", "https://c.fr/1", "https://d.fr/1"], 2: ["https://b.fr/2", "https://c.fr/2", "https://c.fr/3"] };
  const t = setup({ competitors: [C1], pages: pagesFor([1, 2], (n) => links[n]) });
  const r = await t.scan.runCompetitorScan({ trigger: "planifie" });
  assert.equal(r.candidates, 4);
  const notifs = t.kv.get("notifications");
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].type, "competitors_candidates");
  assert.equal(notifs[0].severity, "info");
  assert.equal(notifs[0].read, false);
  assert.match(notifs[0].detail, /planifié/);
  assert.match(notifs[0].detail, /4 nouveaux domaines candidats \(c\.fr, b\.fr, a\.fr…\)/);

  await t.scan.runCompetitorScan({ trigger: "manuel", by: "x" });
  assert.equal(t.kv.get("notifications").length, 1, "N = 0 : pas de notification");
});

test("verrou « competitors » distinct de « chain » ; déjà pris → { skipped: 'busy' } sans crawl ni exception", async () => {
  const t = setup({ competitors: [C1], pages: pagesFor([1], () => []) });
  await t.scan.runCompetitorScan({ trigger: "manuel" });
  assert.deepEqual(t.lockCalls, [SCAN_LOCK]);
  assert.equal(SCAN_LOCK, "competitors");
  assert.equal(t.locks.size, 0, "bail rendu");

  t.locks.set(SCAN_LOCK, { owner: "autre", since: "2026-10-27T09:59:00.000Z" });
  t.crawled.length = 0;
  assert.deepEqual(await t.scan.runCompetitorScan({ trigger: "manuel" }), { skipped: "busy" });
  assert.deepEqual(t.crawled, []);
});

test("contrat A : scanState, listCandidates, setCandidateStatus", async () => {
  const t = setup({ competitors: [C1], pages: pagesFor([1], () => ["https://a.fr/1", "https://b.fr/1"]), settings: { competitors_scan_enabled: "oui", competitors_scan_times: "02:30, 14:00" } });
  assert.deepEqual(await t.scan.scanState(), { running: false, startedAt: null, last: null, enabled: true, next: "2026-10-27T13:00:00.000Z" });
  const last = await t.scan.runCompetitorScan({ trigger: "manuel", by: "Camille" });
  t.locks.set(SCAN_LOCK, { owner: "x", since: "2026-10-27T10:05:00.000Z" });
  assert.deepEqual(await t.scan.scanState(), { running: true, startedAt: "2026-10-27T10:05:00.000Z", last, enabled: true, next: "2026-10-27T13:00:00.000Z" });

  const list = await t.scan.listCandidates({});
  assert.deepEqual(Object.keys(list[0]), ["id", "domain", "status", "occurrences", "competitors", "articles", "firstSeenAt", "lastSeenAt", "decidedBy", "decidedAt"]);
  assert.ok(list[0].lastSeenAt >= list[1].lastSeenAt, "lastSeenAt décroissant");

  const done = await t.scan.setCandidateStatus(list[0].id, "ecarte", "Camille");
  assert.equal(done.status, "ecarte");
  assert.equal(done.decidedBy, "Camille");
  assert.deepEqual((await t.scan.listCandidates({ status: "ecarte" })).map((c) => c.id), [list[0].id]);
  await assert.rejects(t.scan.setCandidateStatus(list[0].id, "supprime", "x"), (e) => e.status === 400);
  await assert.rejects(t.scan.setCandidateStatus(999, "ecarte", "x"), (e) => e.status === 404);
  await assert.rejects(t.scan.setCandidateStatus("abc", "ecarte", "x"), (e) => e.status === 404);
  await assert.rejects(t.scan.listCandidates({ status: "n'importe" }), (e) => e.status === 400);

  const off = setup({ competitors: [], settings: { competitors_scan_enabled: "non" } });
  assert.equal((await off.scan.scanState()).next, null, "désactivé : pas de prochain créneau");
});

/* --- critère 3 : garde SSRF ---------------------------------------------- */

/* dns.lookup simulé : nom → adresses. */
const fakeLookup = (table) => (host, opts, cb) => {
  const list = table[host];
  if (!list) return cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" }));
  cb(null, list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
};

test("critère 3 : localhost, IP littérale ou nom résolu vers une IP privée → concurrent refusé sans requête", async () => {
  const lookup = fakeLookup({ "interne.exemple.fr": ["93.184.216.34", "10.0.0.5"], "meta.exemple.fr": ["169.254.169.254"] });
  const bad = [
    { id: 11, label: "Local", url: "http://localhost:3000/actus" },
    { id: 12, label: "IP privée", url: "http://10.0.0.1/actus" },
    { id: 13, label: "IP publique littérale", url: "https://93.184.216.34/actus" },
    { id: 14, label: "IPv6 bouclage", url: "http://[::1]/actus" },
    { id: 15, label: "Rebond DNS", url: "https://interne.exemple.fr/actus" },
    { id: 16, label: "Métadonnées", url: "https://meta.exemple.fr/" },
  ];
  const t = setup({ competitors: bad, refused: (u) => refusedUrl(u, { lookup }) });
  const last = await t.scan.runCompetitorScan({ trigger: "manuel" });
  assert.deepEqual(t.calls, [], "aucune requête");
  assert.deepEqual(t.crawled, [], "aucun crawl lancé");
  assert.equal(last.errors, bad.length);
  for (const c of bad) {
    assert.equal(t.repo.scans.get(c.id).status, "erreur");
    assert.match(t.repo.scans.get(c.id).error, /^adresse refusée : /);
  }
  assert.match(t.repo.scans.get(15).error, /10\.0\.0\.5/);
  assert.equal(await refusedUrl("https://www.concurrent.fr/", { lookup: fakeLookup({ "www.concurrent.fr": ["93.184.216.34"] }) }), null);
  assert.equal(refusedHost("ftp://concurrent.fr/"), "protocole refusé");
});

test("critère 3 : dans le crawl, un nom résolu vers une IP privée n'ouvre aucune connexion", async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => { hits++; res.end("secret"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const fetchSafe = safeFetcher({ lookup: fakeLookup({ "piege.exemple.fr": ["127.0.0.1"] }) });
    await assert.rejects(fetchSafe(`http://piege.exemple.fr:${port}/robots.txt`), /adresse privée \(127\.0\.0\.1\)/);
    assert.equal(hits, 0);
    /* Témoin : la même requête, adresse privée permise, atteint bien le serveur. */
    const res = await safeGet(`http://piege.exemple.fr:${port}/`, { lookup: fakeLookup({ "piege.exemple.fr": ["127.0.0.1"] }), allowPrivate: true });
    res.cancel();
    assert.equal(hits, 1);
  } finally {
    server.close();
  }
});

test("critère 3 : chaque redirection repasse par la garde ; lecture et erreurs au format de fetchCapped", async () => {
  const gets = [];
  const reply = (status, { location, body = "" } = {}) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (n) => (n === "location" ? location ?? null : null) },
    body: (async function* () { yield Buffer.from(body); })(),
    cancel() {},
  });
  const routes = {
    "https://www.concurrent.fr/a": reply(301, { location: "/b" }),
    "https://www.concurrent.fr/b": reply(200, { body: "contenu é" }),
    "https://www.concurrent.fr/piege": reply(302, { location: "http://localhost/admin" }),
    "https://www.concurrent.fr/ip": reply(302, { location: "http://169.254.169.254/latest/meta-data" }),
    "https://www.concurrent.fr/absent": reply(404),
  };
  const fetchSafe = safeFetcher({ get: async (url) => { gets.push(url); return routes[url]; } });
  assert.equal(await fetchSafe("https://www.concurrent.fr/a"), "contenu é");
  assert.deepEqual(gets, ["https://www.concurrent.fr/a", "https://www.concurrent.fr/b"]);
  gets.length = 0;
  await assert.rejects(fetchSafe("https://www.concurrent.fr/piege"), /hôte local refusé \(localhost\)/);
  await assert.rejects(fetchSafe("https://www.concurrent.fr/ip"), /IP littérale/);
  await assert.rejects(fetchSafe("http://10.0.0.1/"), /IP littérale/);
  assert.deepEqual(gets, ["https://www.concurrent.fr/piege", "https://www.concurrent.fr/ip"], "la cible refusée n'est jamais demandée");
  await assert.rejects(fetchSafe("https://www.concurrent.fr/absent"), /^Error: HTTP 404$/);
});
