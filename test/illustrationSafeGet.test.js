/* M3-66, T5 — DNS rebinding : la socket ne se connecte qu'à l'IP que le lookup
   vient de valider. Vrai serveur HTTP local (127.0.0.1), DNS simulé : les noms
   *.test n'existent que par le `lookup` injecté. Pour pouvoir se connecter au
   serveur local, la politique de test tient 127.0.0.1 pour « publique » et
   10.0.0.0/8 pour privée ; la vraie politique (privateIp) est testée ailleurs. */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { MAX_IMAGE_BYTES, resolveFeaturedMedia } from "../src/publish/illustration.js";
import { checkedLookup, PRIVATE_ADDRESS, safeGet } from "../src/publish/safeGet.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const isPrivate = (ip) => ip.startsWith("10.");
const PUBLIC = "127.0.0.1";
const PRIVATE = "10.66.0.1";

/* DNS simulé : rend, appel après appel, les adresses de `answers` (la dernière
   se répète), au format de dns.lookup({ all: true }). */
function fakeDns(...answers) {
  const calls = [];
  const lookup = (hostname, opts, cb) => {
    calls.push({ hostname, opts });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    setImmediate(() => cb(null, [].concat(a).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))));
  };
  return { lookup, calls };
}

let server, port;
const hits = [];
let redirectClosed, bigClosed;
test.before(async () => {
  server = http.createServer((req, res) => {
    hits.push({ path: req.url, host: req.headers.host });
    if (req.url === "/img.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG); }
    if (req.url === "/redir-self") {
      /* Redirection au corps sans fin : seul un client qui l'abandonne s'en sort. */
      res.writeHead(302, { location: "/img.png", "content-type": "text/plain" });
      const t = setInterval(() => res.write("x".repeat(1024)), 5);
      res.on("close", () => { clearInterval(t); redirectClosed?.(); });
      return;
    }
    if (req.url === "/big.png") {
      /* Image sans content-length qui ne s'arrête pas : seul le plafond de lecture l'arrête. */
      res.writeHead(200, { "content-type": "image/png" });
      const chunk = Buffer.alloc(256 * 1024);
      const t = setInterval(() => res.write(chunk), 1);
      res.on("close", () => { clearInterval(t); bigClosed?.(); });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
test.after(() => { server.closeAllConnections(); server.close(); });

const fakeClient = () => {
  const uploaded = [];
  return { uploaded, get: async () => [], post: async () => ({}), upload: async (route, bytes, f) => { uploaded.push({ bytes, ...f }); return { id: 77 }; } };
};

/* ---------- Le lookup ---------- */

test("checkedLookup : options.all (autoSelectFamily) → liste validée ; une seule adresse privée suffit à refuser", async () => {
  const call = (dns, opts) => new Promise((resolve) => checkedLookup({ lookup: dns.lookup, isPrivate })("x.test", opts, (err, a, f) => resolve({ err, a, f })));
  const ok = await call(fakeDns([PUBLIC, "127.0.0.2"]), { all: true });
  assert.equal(ok.err, null);
  assert.deepEqual(ok.a.map((x) => x.address), [PUBLIC, "127.0.0.2"]);
  const one = await call(fakeDns([PUBLIC]), { family: 0 });
  assert.equal(one.a, PUBLIC);
  assert.equal(one.f, 4);
  const mixed = await call(fakeDns([PUBLIC, PRIVATE]), { all: true });
  assert.equal(mixed.err.code, PRIVATE_ADDRESS);
  const mixed1 = await call(fakeDns([PUBLIC, PRIVATE]), {});
  assert.equal(mixed1.err.code, PRIVATE_ADDRESS, "même sans all : toutes les adresses sont jugées");
});

/* ---------- La connexion ---------- */

test("safeGet : la socket va à l'IP rendue par le lookup, le nom reste dans Host", async () => {
  const dns = fakeDns(PUBLIC);
  const res = await safeGet(`http://img.test:${port}/img.png`, { lookup: dns.lookup, isPrivate });
  assert.equal(res.status, 200);
  const chunks = [];
  for await (const c of res.body) chunks.push(c);
  assert.deepEqual(Buffer.concat(chunks), PNG);
  assert.equal(hits.at(-1).host, `img.test:${port}`, "Host porte le nom, pas l'IP");
  assert.equal(dns.calls.length, 1, "une connexion, une résolution");
  assert.equal(dns.calls[0].hostname, "img.test");
});

test("rebinding : nom résolu d'abord en IP publique puis en IP privée → aucune connexion vers l'IP privée", async () => {
  /* 1re résolution publique (la connexion a lieu), 2e privée (refus AVANT
     connexion) : pas de seconde résolution cachée entre contrôle et connexion. */
  const dns = fakeDns(PUBLIC, PRIVATE);
  const avant = hits.length;
  const first = await safeGet(`http://rebind.test:${port}/img.png`, { lookup: dns.lookup, isPrivate });
  first.cancel();
  assert.equal(first.status, 200);
  await assert.rejects(safeGet(`http://rebind.test:${port}/img.png`, { lookup: dns.lookup, isPrivate }), (e) => e.code === PRIVATE_ADDRESS);
  assert.equal(dns.calls.length, 2);
  assert.equal(hits.length - avant, 1, "seule la connexion validée a eu lieu");
});

test("rebinding par redirection : le saut suivant repasse par le même lookup et s'arrête", async () => {
  const dns = fakeDns(PUBLIC, PRIVATE);
  const client = fakeClient();
  const avant = hits.length;
  const r = await resolveFeaturedMedia(client, { url: `http://rebind.test:${port}/redir-self` }, {
    siteUrl: "http://wp.test",
    lookup: dns.lookup,
    get: (url, opts) => safeGet(url, { ...opts, isPrivate }),
  });
  assert.match(r.error, /réseau local/);
  assert.equal(client.uploaded.length, 0);
  assert.deepEqual(hits.slice(avant).map((h) => h.path), ["/redir-self"], "/img.png jamais atteinte");
  assert.equal(dns.calls.length, 2);
});

/* ---------- Corps des redirections ---------- */

test("corps d'une 3xx annulé : la connexion est fermée sans lire le corps (sans fin ici), le saut suivant aboutit", async () => {
  const closed = new Promise((r) => { redirectClosed = r; });
  const client = fakeClient();
  const r = await resolveFeaturedMedia(client, { url: `http://img.test:${port}/redir-self` }, {
    siteUrl: `http://img.test:${port}`, // site cible : adresse locale admise
    lookup: fakeDns(PUBLIC).lookup,
  });
  assert.equal(r.error, null);
  assert.equal(r.mediaId, 77);
  assert.deepEqual(client.uploaded[0].bytes, PNG);
  await Promise.race([closed, new Promise((_, no) => setTimeout(() => no(new Error("corps de la 3xx jamais abandonné")), 2000))]);
});

/* ---------- Politique réelle et plafond ---------- */

test("safeGet avec la VRAIE politique (privateIp) : un lookup qui rend une IP privée est refusé avant connexion", async () => {
  for (const ip of ["10.0.0.5", "169.254.169.254", "127.0.0.1", "64:ff9b::7f00:1", "::ffff:a9fe:a9fe"]) {
    const avant = hits.length;
    await assert.rejects(safeGet(`http://vrai.test:${port}/img.png`, { lookup: fakeDns(ip).lookup }), (e) => e.code === PRIVATE_ADDRESS, ip);
    assert.equal(hits.length, avant, `aucune connexion (${ip})`);
  }
});

test("plafond de taille en flux : image sans fin et sans content-length abandonnée au-delà du plafond", async () => {
  const closed = new Promise((r) => { bigClosed = r; });
  const client = fakeClient();
  const r = await resolveFeaturedMedia(client, { url: `http://img.test:${port}/big.png` }, {
    siteUrl: `http://img.test:${port}`,
    lookup: fakeDns(PUBLIC).lookup,
  });
  assert.match(r.error, new RegExp(`dépasse ${MAX_IMAGE_BYTES / 1024 / 1024} Mo`));
  assert.equal(client.uploaded.length, 0);
  await Promise.race([closed, new Promise((_, no) => setTimeout(() => no(new Error("flux jamais abandonné")), 2000))]);
});
