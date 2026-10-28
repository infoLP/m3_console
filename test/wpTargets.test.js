/* M3-53 — cibles de publication WordPress : validation, secret jamais renvoyé,
   cible par défaut unique, choix de la cible d'une parution. Le dépôt est en
   mémoire et le chiffrement factice : aucun test ne touche la base ni un vrai
   WordPress. */

import test from "node:test";
import assert from "node:assert/strict";

import { createWpTargets, hintOfAppPassword, normalizeUrl, toPublic, validateTarget } from "../src/lib/wpTargets.js";
import { targetsList, targetCreate, targetUpdate, targetActivate, targetRemove, targetTest } from "../src/api/wpTargets.js";

/* ------------------------------------------------------------ doublures */

const CRYPTO = {
  encrypt: (s) => `enc:${s}`,
  decrypt: (s) => (String(s).startsWith("enc:") ? String(s).slice(4) : null),
  hint: (s) => `${s.slice(0, 2)}…${s.slice(-2)}`,
  available: () => true,
};

function memoryRepo() {
  const rows = [];
  let next = 1;
  const sorted = () => [...rows].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  const unique = (name, id) => {
    if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== id)) {
      throw Object.assign(new Error("doublon"), { code: "23505", constraint: "wp_targets_name_idx" });
    }
  };
  return {
    rows,
    async all() { return sorted().map((r) => ({ ...r })); },
    async byId(id) { const r = rows.find((x) => x.id === Number(id)); return r ? { ...r } : null; },
    async insert(f, { makeDefault }) {
      unique(f.name, null);
      if (makeDefault) rows.forEach((r) => { r.is_default = false; });
      const row = {
        id: next++, name: f.name, url: f.url, wp_user: f.wpUser, secret_enc: f.secretEnc, secret_hint: f.secretHint,
        seo_plugin: f.seoPlugin, create_categories: f.createCategories, publish_status: f.publishStatus,
        is_default: !!makeDefault, active: true, created_by: f.createdBy, created_at: "2026-10-26T10:00:00Z", updated_at: "2026-10-26T10:00:00Z",
      };
      rows.push(row);
      return { ...row };
    },
    async update(id, f, { makeDefault }) {
      const r = rows.find((x) => x.id === Number(id));
      if (!r) return null;
      unique(f.name, r.id);
      if (makeDefault) rows.forEach((x) => { if (x.id !== r.id) x.is_default = false; });
      Object.assign(r, { name: f.name, url: f.url, wp_user: f.wpUser, seo_plugin: f.seoPlugin, create_categories: f.createCategories, publish_status: f.publishStatus });
      if (f.secretEnc) Object.assign(r, { secret_enc: f.secretEnc, secret_hint: f.secretHint });
      if (makeDefault) r.is_default = true;
      return { ...r };
    },
    async setActive(id, active) {
      const r = rows.find((x) => x.id === Number(id));
      if (!r) return null;
      r.active = active;
      if (!active) r.is_default = false;
      return { ...r };
    },
    async remove(id) { rows.splice(rows.findIndex((x) => x.id === Number(id)), 1); },
  };
}

const service = (crypto = CRYPTO) => { const repo = memoryRepo(); return { repo, svc: createWpTargets({ repo, crypto }) }; };

const SAISIE = { name: "Vie économique", url: "https://www.vie-economique.test/", wpUser: "console", password: "abcd efgh ijkl mnop", seoPlugin: "rankmath", publishStatus: "draft" };

/* ----------------------------------------------------------- validation */

test("normalizeUrl : http(s) sans identifiant ni paramètre, sans « / » final", () => {
  assert.equal(normalizeUrl("https://site.test/"), "https://site.test");
  assert.equal(normalizeUrl(" http://site.test/blog/ "), "http://site.test/blog");
  assert.equal(normalizeUrl("ftp://site.test"), null);
  assert.equal(normalizeUrl("https://u:p@site.test"), null);
  assert.equal(normalizeUrl("https://site.test/?a=1"), null);
  assert.equal(normalizeUrl("pas une adresse"), null);
});

test("validateTarget : refuse ce qui est invalide, avec la raison", () => {
  assert.match(validateTarget({ ...SAISIE, name: "x" }, { creating: true }).error, /Nom trop court/);
  assert.match(validateTarget({ ...SAISIE, url: "site.test" }, { creating: true }).error, /Adresse invalide/);
  assert.match(validateTarget({ ...SAISIE, wpUser: " " }, { creating: true }).error, /Compte WordPress/);
  assert.match(validateTarget({ ...SAISIE, password: "" }, { creating: true }).error, /Mot de passe d'application requis/);
  assert.match(validateTarget({ ...SAISIE, password: "court" }, { creating: false }).error, /trop court/);
  assert.match(validateTarget({ ...SAISIE, seoPlugin: "inconnu" }, { creating: true }).error, /Greffon SEO inconnu/);
  assert.match(validateTarget({ ...SAISIE, publishStatus: "demain" }, { creating: true }).error, /Statut d'arrivée inconnu/);
});

test("validateTarget : à la modification, le mot de passe vide est accepté (on garde l'ancien)", () => {
  const v = validateTarget({ ...SAISIE, password: "" }, { creating: false });
  assert.equal(v.error, undefined);
  assert.equal(v.value.password, null);
  assert.equal(v.value.url, "https://www.vie-economique.test");
});

test("validateTarget : une cible neuve arrive en brouillon, sans création de rubriques", () => {
  const v = validateTarget({ name: "Site", url: "https://s.test", wpUser: "c", password: "abcdefgh" }, { creating: true });
  assert.equal(v.value.publishStatus, "draft");
  assert.equal(v.value.createCategories, false);
  assert.equal(v.value.seoPlugin, "none");
});

test("hintOfAppPassword : 4 derniers caractères seulement, espaces ignorés", () => {
  assert.equal(hintOfAppPassword("abcd efgh ijkl mnop"), "…mnop");
  assert.equal(hintOfAppPassword("court"), "…");
  assert.equal(hintOfAppPassword(""), "…");
});

/* -------------------------------------------------------------- service */

test("create : le mot de passe est chiffré, jamais renvoyé ; seule l'empreinte l'est", async () => {
  const { repo, svc } = service();
  const t = await svc.create(SAISIE, { by: "A. Sanchez" });
  assert.equal(repo.rows[0].secret_enc, "enc:abcd efgh ijkl mnop");
  assert.equal(t.secretHint, "ab…op");
  assert.equal(JSON.stringify(t).includes("abcd efgh"), false);
  assert.equal(JSON.stringify(await svc.list()).includes("abcd efgh"), false);
  assert.equal(Object.hasOwn(toPublic(repo.rows[0]), "secret_enc"), false);
  assert.equal(t.createdBy, "A. Sanchez");
});

test("create : la première cible devient la cible par défaut, pas la suivante", async () => {
  const { svc } = service();
  const a = await svc.create(SAISIE);
  const b = await svc.create({ ...SAISIE, name: "Autre site" });
  assert.equal(a.isDefault, true);
  assert.equal(b.isDefault, false);
});

test("create : une cible par défaut remplace la précédente (une seule à la fois)", async () => {
  const { svc } = service();
  await svc.create(SAISIE);
  await svc.create({ ...SAISIE, name: "Autre site", isDefault: true });
  const defauts = (await svc.list()).filter((t) => t.isDefault);
  assert.deepEqual(defauts.map((t) => t.name), ["Autre site"]);
});

test("create : sans M3_SECRET_KEY, refus explicite (503), rien n'est stocké en clair", async () => {
  const { repo, svc } = service({ ...CRYPTO, available: () => false });
  await assert.rejects(svc.create(SAISIE), (e) => e.status === 503 && /M3_SECRET_KEY/.test(e.message));
  assert.equal(repo.rows.length, 0);
});

test("create : un nom déjà pris est refusé (409), sans tenir compte de la casse", async () => {
  const { svc } = service();
  await svc.create(SAISIE);
  await assert.rejects(svc.create({ ...SAISIE, name: "vie économique" }), (e) => e.status === 409);
});

test("update : mot de passe vide = ancien conservé ; renseigné = remplacé", async () => {
  const { repo, svc } = service();
  const t = await svc.create(SAISIE);
  await svc.update(t.id, { ...SAISIE, password: "", publishStatus: "publish" });
  assert.equal(repo.rows[0].secret_enc, "enc:abcd efgh ijkl mnop");
  assert.equal(repo.rows[0].publish_status, "publish");
  await svc.update(t.id, { ...SAISIE, password: "nouveau-mot-de-passe" });
  assert.equal(repo.rows[0].secret_enc, "enc:nouveau-mot-de-passe");
});

test("update : une cible désactivée ne peut pas devenir la cible par défaut", async () => {
  const { svc } = service();
  await svc.create(SAISIE);
  const b = await svc.create({ ...SAISIE, name: "Autre site" });
  await svc.setActive(b.id, false);
  await assert.rejects(svc.update(b.id, { ...SAISIE, name: "Autre site", isDefault: true }), (e) => e.status === 409);
});

test("setActive : désactiver la cible par défaut lui ôte ce statut", async () => {
  const { svc } = service();
  const a = await svc.create(SAISIE);
  const off = await svc.setActive(a.id, false);
  assert.equal(off.active, false);
  assert.equal(off.isDefault, false);
});

test("remove : seulement une cible déjà désactivée", async () => {
  const { repo, svc } = service();
  const a = await svc.create(SAISIE);
  await assert.rejects(svc.remove(a.id), (e) => e.status === 409 && /Désactivez d'abord/.test(e.message));
  await svc.setActive(a.id, false);
  assert.deepEqual(await svc.remove(a.id), { id: a.id, name: "Vie économique" });
  assert.equal(repo.rows.length, 0);
  await assert.rejects(svc.remove(a.id), (e) => e.status === 404);
});

/* -------------------------------------------- choix de la cible d'une parution */

test("resolveForPublish : la cible demandée, sinon la par défaut, sinon l'unique active", async () => {
  const { svc } = service();
  const a = await svc.create(SAISIE);
  const b = await svc.create({ ...SAISIE, name: "Autre site", url: "https://b.test" });
  assert.equal((await svc.resolveForPublish(b.id)).url, "https://b.test");
  assert.equal((await svc.resolveForPublish()).id, a.id);
  await svc.setActive(a.id, false);
  assert.equal((await svc.resolveForPublish()).id, b.id, "unique cible active");
});

test("resolveForPublish : rend les identifiants en clair, pour wordpress.js seulement", async () => {
  const { svc } = service();
  await svc.create(SAISIE);
  const t = await svc.resolveForPublish();
  assert.equal(t.appPassword, "abcd efgh ijkl mnop");
  assert.equal(t.user, "console");
  assert.equal(t.publishStatus, "draft");
});

test("resolveForPublish : plusieurs cibles actives sans défaut → aucune (pas de choix au hasard)", async () => {
  const { svc } = service();
  const a = await svc.create(SAISIE);
  await svc.create({ ...SAISIE, name: "Autre site" });
  await svc.setActive(a.id, false); // le défaut disparaît
  await svc.setActive(a.id, true);
  assert.equal(await svc.resolveForPublish(), null);
});

test("resolveForPublish : une cible désactivée demandée par son numéro est refusée (409)", async () => {
  const { svc } = service();
  const a = await svc.create(SAISIE);
  await svc.setActive(a.id, false);
  await assert.rejects(svc.resolveForPublish(a.id), (e) => e.status === 409);
  await assert.rejects(svc.resolveForPublish(999), (e) => e.status === 404);
});

test("resolveForPublish : un mot de passe devenu illisible est dit, pas ignoré (503)", async () => {
  const { repo, svc } = service();
  await svc.create(SAISIE);
  repo.rows[0].secret_enc = "corrompu";
  await assert.rejects(svc.resolveForPublish(), (e) => e.status === 503 && /illisible/.test(e.message));
});

/* ------------------------------------------------- l'API : droits */

test("l'onglet Publication est réservé à l'administrateur : refus 403 avant toute lecture", async () => {
  const handlers = { targetsList, targetCreate, targetUpdate, targetActivate, targetRemove, targetTest };
  for (const [nom, handler] of Object.entries(handlers)) {
    for (const role of ["relecteur", "super_utilisateur"]) {
      const reponses = [];
      const res = { writeHead: (s) => reponses.push(s), setHeader() {}, end() {} };
      await handler({ res, role, params: ["1"], body: SAISIE, user: null });
      assert.deepEqual(reponses, [403], `${nom} / ${role}`);
    }
  }
});
