/* M3-117 — liste blanche du furtif au back-office (src/api/sources.js) : la
   liste reflète l'état de récolte réel, le retrait ne change que le champ
   `furtif` de la source et passe par updateJson (verrou de ligne), un rôle non
   administrateur reçoit 403 en lecture comme en écriture. Base simulée : le
   verrou lui-même est prouvé par test/storeUpdateJson.test.js (vraie base). */

import test from "node:test";
import assert from "node:assert/strict";
import { listeBlancheFurtif, lireListeBlanche, retirerDeListeBlanche, furtif, retirerFurtif } from "../src/api/sources.js";
import { SOURCES_STATE_KEY } from "../src/ingest/harvestRun.js";

const MAINTENANT = Date.parse("2026-10-27T10:00:00.000Z");
const JOUR = 86400000;
const iso = (ms) => new Date(ms).toISOString();

const etat = () => ({
  a: { lastOkAt: iso(MAINTENANT - JOUR), failures: 0, furtif: { since: iso(MAINTENANT - 10 * JOUR), checkedAt: iso(MAINTENANT - 3 * JOUR) },
    yield: { recent: [{ at: iso(MAINTENANT - 2 * JOUR), ok: false, n: 0 }, { at: iso(MAINTENANT - JOUR), ok: true, n: 4 }] } },
  b: { failures: 5, quarantinedUntil: iso(MAINTENANT + 2 * JOUR), furtif: { since: iso(MAINTENANT - 20 * JOUR) },
    yield: { recent: [{ at: iso(MAINTENANT - JOUR), ok: false, n: 0 }] } },
  c: { failures: 3, quarantinedUntil: iso(MAINTENANT - JOUR) },
  d: { failures: 0, lastOkAt: iso(MAINTENANT) },
  e: { failures: 4, quarantinedUntil: iso(MAINTENANT + JOUR) },
});
const SOURCES = [{ id: "a", name: "Mairie A" }, { id: "b", name: "Préfecture B" }, { id: "c", name: "C" }, { id: "d", name: "D" }];

/* Comme la version PostgreSQL : la valeur est relue au moment du verrou, la
   fonction tourne dessus, le résultat remplace le document. Les appels sont
   enregistrés pour vérifier la clé et l'absence d'écriture hors updateJson. */
function baseSimulee(initial) {
  const kv = new Map([[SOURCES_STATE_KEY, structuredClone(initial)]]);
  const appels = [];
  const maj = async (k, fn, fb = null) => {
    appels.push(k);
    const v = fn(kv.has(k) ? structuredClone(kv.get(k)) : fb);
    kv.set(k, structuredClone(v));
    return v;
  };
  const lire = async (k, fb = null) => (kv.has(k) ? structuredClone(kv.get(k)) : fb);
  return { kv, appels, maj, lire };
}

function reponse() {
  return { status: null, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
}

test("la liste reflète l'état réel : furtif.since, dernier re-test, dernier résultat, quarantinedUntil", () => {
  const { furtif: lb, ecart } = listeBlancheFurtif(etat(), SOURCES, MAINTENANT);
  assert.deepEqual(lb.map((l) => l.id), ["b", "a"]);   // plus ancienne d'abord
  const a = lb.find((l) => l.id === "a");
  assert.equal(a.name, "Mairie A");
  assert.equal(a.since, iso(MAINTENANT - 10 * JOUR));
  assert.equal(a.checkedAt, iso(MAINTENANT - 3 * JOUR));
  assert.equal(a.prochainRetest, iso(MAINTENANT + 4 * JOUR));
  assert.deepEqual(a.dernier, { at: iso(MAINTENANT - JOUR), ok: true, n: 4 });
  const b = lb.find((l) => l.id === "b");
  assert.equal(b.checkedAt, null);
  assert.equal(b.prochainRetest, iso(MAINTENANT - 13 * JOUR));   // re-test dû
  assert.equal(b.dernier.ok, false);

  /* Mises à l'écart en cours seulement : c est échue, d n'a rien. */
  assert.deepEqual(ecart.map((l) => l.id), ["e", "b"]);
  const e = ecart.find((l) => l.id === "e");
  assert.equal(e.quarantinedUntil, iso(MAINTENANT + JOUR));
  assert.equal(e.failures, 4);
  assert.equal(e.enFurtif, false);
  assert.equal(e.connue, false);   // hors référentiel : nom = id
  assert.equal(e.name, "e");
  assert.equal(ecart.find((l) => l.id === "b").enFurtif, true);
});

test("liste vide sur un état absent ou abîmé", () => {
  assert.deepEqual(listeBlancheFurtif(null, SOURCES, MAINTENANT), { furtif: [], ecart: [] });
  assert.deepEqual(listeBlancheFurtif({ x: null, y: "?" }, [], MAINTENANT), { furtif: [], ecart: [] });
});

test("lireListeBlanche lit la clé de l'état de récolte", async () => {
  const db = baseSimulee(etat());
  const lu = [];
  const r = await lireListeBlanche({ lire: (k, fb) => { lu.push(k); return db.lire(k, fb); }, sources: async () => SOURCES, maintenant: MAINTENANT });
  assert.deepEqual(lu, [SOURCES_STATE_KEY]);
  assert.equal(r.furtif.length, 2);
});

test("retrait : l'état est réellement mis à jour, via updateJson, et seul `furtif` change", async () => {
  const db = baseSimulee(etat());
  assert.equal(await retirerDeListeBlanche("a", { maj: db.maj }), true);
  assert.deepEqual(db.appels, [SOURCES_STATE_KEY]);
  const apres = db.kv.get(SOURCES_STATE_KEY);
  assert.equal(apres.a.furtif, undefined);
  const { furtif: _f, ...reste } = etat().a;
  assert.deepEqual(apres.a, reste);   // lastOkAt, yield… intacts
  assert.deepEqual(apres.b, etat().b);   // les autres sources ne bougent pas
  const { furtif: lb } = listeBlancheFurtif(apres, SOURCES, MAINTENANT);
  assert.deepEqual(lb.map((l) => l.id), ["b"]);
});

test("retrait : la transformation s'applique à la valeur lue sous le verrou (écriture concurrente conservée)", async () => {
  const db = baseSimulee(etat());
  /* Une récolte écrit l'état de `d` entre la lecture de l'écran et le retrait. */
  await db.maj(SOURCES_STATE_KEY, (all) => ({ ...all, d: { failures: 1 } }), {});
  await retirerDeListeBlanche("b", { maj: db.maj });
  const apres = db.kv.get(SOURCES_STATE_KEY);
  assert.deepEqual(apres.d, { failures: 1 });
  assert.equal(apres.b.furtif, undefined);
  assert.equal(apres.b.quarantinedUntil, etat().b.quarantinedUntil);   // la mise à l'écart reste
});

test("retrait d'une source absente de la liste blanche : false, état inchangé", async () => {
  const db = baseSimulee(etat());
  assert.equal(await retirerDeListeBlanche("d", { maj: db.maj }), false);
  assert.equal(await retirerDeListeBlanche("inconnue", { maj: db.maj }), false);
  assert.deepEqual(db.kv.get(SOURCES_STATE_KEY), etat());
});

for (const role of ["super_utilisateur", "relecteur", undefined]) {
  test(`rôle ${role ?? "absent"} : ni lecture ni retrait (403), aucune base touchée`, async () => {
    const r1 = reponse();
    await furtif({ res: r1, role });
    assert.equal(r1.status, 403);
    assert.equal(r1.body.furtif, undefined);
    const r2 = reponse();
    await retirerFurtif({ res: r2, role, params: ["a"] });
    assert.equal(r2.status, 403);
  });
}
