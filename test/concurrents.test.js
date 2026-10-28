/* M3-120 — Sites concurrents (Sources → Concurrents) : le service
   (src/lib/competitors.js) sur un dépôt en mémoire, les handlers
   (src/api/concurrents.js) et leur 403, et la garde de CHAQUE page du
   back-office : la coque /admin s'ouvre désormais au superutilisateur, qui ne
   doit pourtant ouvrir que Concurrents. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCompetitors, normalizeUrl, toPublic, validateCompetitor } from "../src/lib/competitors.js";
import { handlers } from "../src/api/concurrents.js";
import { can } from "../shared/model.js";

/* Dépôt en mémoire, avec l'index unique de la migration 020 (lower(url)). */
function memRepo() {
  let rows = [];
  let seq = 0;
  const unique = (url, id = null) => {
    if (rows.some((r) => r.url.toLowerCase() === url.toLowerCase() && r.id !== id)) {
      throw Object.assign(new Error("duplicate key"), { code: "23505", constraint: "competitors_url_idx" });
    }
  };
  return {
    rows: () => rows,
    async all() { return rows.map((r) => ({ ...r })); },
    async byId(id) { const r = rows.find((x) => x.id === Number(id)); return r ? { ...r } : null; },
    async insert(f) {
      unique(f.url);
      const r = { id: ++seq, label: f.label, url: f.url, active: true, created_by: f.createdBy, created_at: "t0", updated_at: "t0" };
      rows.push(r);
      return { ...r };
    },
    async update(id, f) {
      const r = rows.find((x) => x.id === Number(id));
      if (!r) return null;
      unique(f.url, r.id);
      Object.assign(r, { label: f.label, url: f.url, updated_at: "t1" });
      return { ...r };
    },
    async setActive(id, active) {
      const r = rows.find((x) => x.id === Number(id));
      if (!r) return null;
      r.active = active;
      return { ...r };
    },
    async remove(id) { rows = rows.filter((x) => x.id !== Number(id)); },
  };
}

const rejette = (p, status, motif) => assert.rejects(p, (e) => e.status === status && (!motif || motif.test(e.message)));

/* ---------------------------------------------------------------- service */

test("normalisation de l'adresse : hôte en minuscules, sans / final ; refus des formes dangereuses", () => {
  assert.equal(normalizeUrl(" https://WWW.SudOuest.fr/ "), "https://www.sudouest.fr");
  assert.equal(normalizeUrl("http://exemple.fr/actu/"), "http://exemple.fr/actu");
  for (const u of ["", "sudouest.fr", "javascript:alert(1)", "ftp://x.fr", "https://a:b@x.fr", "https://x.fr/?p=1", "https://x.fr/#a"]) {
    assert.equal(normalizeUrl(u), null, u);
  }
  assert.ok(validateCompetitor({ label: "A", url: "https://x.fr" }).error);
  assert.ok(validateCompetitor({ label: "Sud Ouest", url: "x.fr" }).error);
});

test("ajout, modification, désactivation, réactivation et retrait d'un concurrent", async () => {
  const repo = memRepo();
  const svc = createCompetitors({ repo });
  const c = await svc.create({ label: "  Sud Ouest ", url: "https://www.sudouest.fr/" }, { by: "Super Test" });
  assert.deepEqual({ ...c, createdAt: undefined, updatedAt: undefined, lastScan: undefined },
    { id: 1, label: "Sud Ouest", url: "https://www.sudouest.fr", active: true, createdBy: "Super Test", createdAt: undefined, updatedAt: undefined, lastScan: undefined });

  const m = await svc.update(c.id, { label: "Sud Ouest Gironde", url: "https://www.sudouest.fr/gironde" });
  assert.equal(m.label, "Sud Ouest Gironde");
  assert.equal(m.url, "https://www.sudouest.fr/gironde");

  assert.equal((await svc.setActive(c.id, false)).active, false);
  assert.equal((await svc.list())[0].active, false);
  assert.equal((await svc.setActive(c.id, true)).active, true);

  assert.deepEqual(await svc.remove(c.id), { id: 1, label: "Sud Ouest Gironde", url: "https://www.sudouest.fr/gironde" });
  assert.deepEqual(await svc.list(), []);
});

test("URL validée et doublon refusé (409), y compris à la casse et au / final près", async () => {
  const svc = createCompetitors({ repo: memRepo() });
  await rejette(svc.create({ label: "Sans schéma", url: "sudouest.fr" }), 400, /Adresse invalide/);
  await rejette(svc.create({ label: "X", url: "https://x.fr" }), 400, /trop court/);
  const a = await svc.create({ label: "Sud Ouest", url: "https://www.sudouest.fr" });
  await rejette(svc.create({ label: "Doublon", url: "https://WWW.SUDOUEST.FR/" }), 409, /déjà suivi/);
  const b = await svc.create({ label: "La Dépêche", url: "https://www.ladepeche.fr" });
  await rejette(svc.update(b.id, { label: "La Dépêche", url: "https://www.sudouest.fr" }), 409, /déjà suivi/);
  /* Se garder soi-même n'est pas un doublon. */
  assert.equal((await svc.update(a.id, { label: "Sud-Ouest", url: "https://www.sudouest.fr" })).label, "Sud-Ouest");
});

test("doublon tranché par l'index unique quand deux saisies se croisent → 409", async () => {
  const repo = memRepo();
  const svc = createCompetitors({ repo: { ...repo, all: async () => [] } });   // la vérification préalable ne voit rien
  await svc.create({ label: "Sud Ouest", url: "https://www.sudouest.fr" });
  await rejette(svc.create({ label: "Bis", url: "https://www.sudouest.fr" }), 409);
});

test("concurrent inconnu → 404", async () => {
  const svc = createCompetitors({ repo: memRepo() });
  await rejette(svc.update(9, { label: "Sud Ouest", url: "https://x.fr" }), 404);
  await rejette(svc.setActive(9, false), 404);
  await rejette(svc.remove(9), 404);
});

/* ---------------------------------------------------------------- handlers */

function reponse() {
  return { status: null, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
}

test("API : le relecteur (ou un rôle absent) reçoit 403 partout, sans toucher au dépôt", async () => {
  const repo = memRepo();
  const h = handlers(createCompetitors({ repo }));
  for (const role of ["relecteur", undefined, "inconnu"]) {
    for (const [nom, ctx] of [
      ["list", {}], ["create", { body: { label: "Sud Ouest", url: "https://x.fr" } }],
      ["update", { params: ["1"], body: { label: "Sud Ouest", url: "https://x.fr" } }],
      ["activate", { params: ["1"], body: { active: false } }], ["remove", { params: ["1"] }],
    ]) {
      const res = reponse();
      await h[nom]({ res, role, ...ctx });
      assert.equal(res.status, 403, `${nom} / ${role}`);
    }
  }
  assert.deepEqual(repo.rows(), []);
});

test("API : le superutilisateur et l'administrateur listent, ajoutent, désactivent et retirent", async () => {
  const h = handlers(createCompetitors({ repo: memRepo() }));
  for (const role of ["super_utilisateur", "administrateur"]) {
    let res = reponse();
    await h.create({ res, role, body: { label: `Site ${role}`, url: `https://${role.replace("_", "-")}.fr` }, user: { name: role } });
    assert.equal(res.status, 200);
    const id = String(res.body.competitor.id);
    res = reponse();
    await h.activate({ res, role, params: [id], body: { active: false } });
    assert.equal(res.body.competitor.active, false);
    res = reponse();
    await h.list({ res, role });
    assert.equal(res.status, 200);
    assert.ok(res.body.competitors.some((c) => String(c.id) === id));
    res = reponse();
    await h.remove({ res, role, params: [id] });
    assert.equal(res.status, 200);
  }
});

/* ------------------------------------------------- gardes des pages /admin */

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = path.join(racine, "src", "app", "(console)", "admin");
const pages = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? pages(path.join(dir, e.name)) : e.name === "page.tsx" ? [path.join(dir, e.name)] : []);
const garde = (src) => [...src.matchAll(/exigerDroit\("([a-z_]+)"/g)].map((m) => m[1]);

test("la coque /admin s'ouvre avec backoffice OU manage_competitors", () => {
  const layout = fs.readFileSync(path.join(ADMIN, "layout.tsx"), "utf8");
  assert.match(layout, /exigerUnDesDroits\(DROITS_COQUE_ADMIN/);
  assert.doesNotMatch(layout, /exigerDroit\(/);
});

test("chaque page /admin garde sa propre garde : backoffice partout, manage_competitors pour Concurrents seulement", () => {
  const liste = pages(ADMIN);
  assert.ok(liste.length >= 11, `${liste.length} page(s) trouvée(s)`);
  for (const p of liste) {
    const rel = path.relative(ADMIN, p).split(path.sep).join("/");
    const g = garde(fs.readFileSync(p, "utf8"));
    if (rel === "concurrents/page.tsx") assert.deepEqual(g, ["manage_competitors"], rel);
    else assert.deepEqual(g, ["backoffice"], rel);
  }
});

test("un superutilisateur n'ouvre aucune autre page /admin que Concurrents ; un relecteur aucune", () => {
  for (const p of pages(ADMIN)) {
    const rel = path.relative(ADMIN, p).split(path.sep).join("/");
    const [droit] = garde(fs.readFileSync(p, "utf8"));
    assert.equal(can("super_utilisateur", droit), rel === "concurrents/page.tsx", rel);
    assert.equal(can("relecteur", droit), false, rel);
    assert.equal(can("administrateur", droit), true, rel);
  }
});

/* ------------------------------------------ scan et candidats (M3-122) */

/* Le moteur de M3-121 (src/ingest/competitorScan.js), simulé au contrat. */
function faux({ running = false, busy = false } = {}) {
  const appels = [];
  let rows = [
    { id: 1, domain: "gironde.fr", status: "nouveau", occurrences: 4, competitors: [{ id: 1, label: "Sud Ouest" }], articles: [], lastSeenAt: "t" },
    { id: 2, domain: "bordeaux-metropole.fr", status: "nouveau", occurrences: 2, competitors: [], articles: [], lastSeenAt: "t" },
    { id: 3, domain: "exemple.org", status: "ecarte", occurrences: 1, competitors: [], articles: [], lastSeenAt: "t" },
  ];
  return {
    appels, rows: () => rows,
    async scanState() { return { running, startedAt: null, last: null, enabled: false, next: null }; },
    runCompetitorScan(o) {
      appels.push(o);
      /* Verrou pris : réponse immédiate ; sinon le scan « tourne » et ne se résout pas ici. */
      return busy ? Promise.resolve({ skipped: "busy" }) : new Promise(() => {});
    },
    async listCandidates({ status, limit }) { return rows.filter((r) => r.status === status).slice(0, limit); },
    async setCandidateStatus(id, status, by) {
      const r = rows.find((x) => x.id === Number(id));
      if (!r) throw Object.assign(new Error("candidat inconnu"), { status: 404 });
      Object.assign(r, { status, decidedBy: by });
      return { ...r };
    },
  };
}
const avecScan = (scan, tickets = { push: async () => {} }) => handlers(createCompetitors({ repo: memRepo() }), { scan, tickets });

test("« Lancer le scan » : runCompetitorScan manuel, réponse immédiate (202) pour l'admin et le SU ; 403 relecteur", async () => {
  for (const role of ["administrateur", "super_utilisateur"]) {
    const scan = faux();
    const res = reponse();
    await avecScan(scan).launchScan({ res, role, user: { name: `Compte ${role}` } });
    assert.equal(res.status, 202, role);
    assert.deepEqual(scan.appels, [{ trigger: "manuel", by: `Compte ${role}` }]);
  }
  const scan = faux();
  for (const role of ["relecteur", undefined]) {
    const res = reponse();
    await avecScan(scan).launchScan({ res, role });
    assert.equal(res.status, 403);
  }
  assert.equal(scan.appels.length, 0);
});

test("second lancement pendant un scan → 409, qu'il se voie dans l'état ou au verrou", async () => {
  let scan = faux({ running: true });
  let res = reponse();
  await avecScan(scan).launchScan({ res, role: "administrateur" });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /déjà en cours/);
  assert.equal(scan.appels.length, 0);

  scan = faux({ busy: true });
  res = reponse();
  await avecScan(scan).launchScan({ res, role: "super_utilisateur" });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /déjà en cours/);
});

test("en production, l'API appelle le moteur de M3-121 (src/ingest/competitorScan.js)", () => {
  const src = fs.readFileSync(path.join(racine, "src", "api", "concurrents.js"), "utf8");
  assert.match(src, /import \* as competitorScan from "\.\.\/ingest\/competitorScan\.js"/);
  assert.match(src, /scan = competitorScan/);
});

test("candidats filtrés par statut (nouveau par défaut) ; statut inconnu → 400 ; relecteur → 403", async () => {
  const h = avecScan(faux());
  let res = reponse();
  await h.candidates({ res, role: "super_utilisateur", query: {} });
  assert.deepEqual(res.body.candidates.map((c) => c.domain), ["gironde.fr", "bordeaux-metropole.fr"]);
  res = reponse();
  await h.candidates({ res, role: "administrateur", query: { status: "ecarte" } });
  assert.deepEqual(res.body.candidates.map((c) => c.domain), ["exemple.org"]);
  res = reponse();
  await h.candidates({ res, role: "administrateur", query: { status: "tout" } });
  assert.equal(res.status, 400);
  res = reponse();
  await h.candidates({ res, role: "relecteur", query: {} });
  assert.equal(res.status, 403);
});

test("Écarter (admin et SU), Proposer (SU : demande d'ajout + « proposé »), Créer la source (admin seul → « ajouté »)", async () => {
  const scan = faux();
  const demandes = [];
  const h = avecScan(scan, { push: async (t) => { demandes.push(t); } });

  let res = reponse();
  await h.discard({ res, role: "super_utilisateur", params: ["2"], user: { name: "SU" } });
  assert.equal(res.body.candidate.status, "ecarte");

  res = reponse();
  await h.propose({ res, role: "super_utilisateur", params: ["1"], user: { name: "Super Test", id: "u-su" } });
  assert.equal(res.status, 200);
  assert.equal(scan.rows()[0].status, "propose");
  assert.equal(demandes.length, 1);
  assert.equal(demandes[0].kind, "ajout_source");
  assert.equal(demandes[0].url, "https://gironde.fr");
  assert.equal(demandes[0].status, "ouvert");
  assert.equal(demandes[0].requestedBy, "Super Test");
  assert.match(demandes[0].note, /4 fois.*Sud Ouest/);

  /* Le SU ne crée pas la source : 403, statut inchangé. */
  res = reponse();
  await h.adopt({ res, role: "super_utilisateur", params: ["1"] });
  assert.equal(res.status, 403);
  assert.equal(scan.rows()[0].status, "propose");

  res = reponse();
  await h.adopt({ res, role: "administrateur", params: ["1"], user: { name: "Admin" } });
  assert.equal(res.status, 200);
  assert.equal(scan.rows()[0].status, "ajoute");
  assert.equal(scan.rows()[0].decidedBy, "Admin");

  for (const [nom, role] of [["discard", "relecteur"], ["propose", "relecteur"], ["adopt", "relecteur"]]) {
    res = reponse();
    await h[nom]({ res, role, params: ["3"] });
    assert.equal(res.status, 403, nom);
  }
  await rejette(h.discard({ res: reponse(), role: "administrateur", params: ["99"] }), 404);
});

test("Proposer : si la demande ne s'enregistre pas, le candidat revient à « nouveau »", async () => {
  const scan = faux();
  const h = avecScan(scan, { push: async () => { throw new Error("base indisponible"); } });
  await assert.rejects(h.propose({ res: reponse(), role: "super_utilisateur", params: ["1"] }), /base indisponible/);
  assert.equal(scan.rows()[0].status, "nouveau");
});

test("dernier scan d'un concurrent exposé par toPublic (colonnes last_scan_* de la migration 021)", () => {
  const base = { id: 1, label: "Sud Ouest", url: "https://www.sudouest.fr", active: true };
  assert.equal(toPublic(base).lastScan, null);
  assert.deepEqual(toPublic({ ...base, last_scan_at: new Date("2026-10-27T09:00:00Z"), last_scan_status: "erreur", last_scan_via: "flux", last_scan_error: "HTTP 503" }).lastScan,
    { at: "2026-10-27T09:00:00.000Z", status: "erreur", via: "flux", error: "HTTP 503" });
});
