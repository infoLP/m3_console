/* T14 (point du 27/10) — purge définitive après t jours, fiche minimale
   retrouvable par UUID, anti-régénération (src/lib/store.js).
   Base simulée en mémoire par `mock.module` (option --experimental-test-module-mocks :
   `npm test` saute ce fichier, `npm run test:wiring` le lance). La simulation
   rejoue la TRANSACTION : un échec au milieu remet articles et fiches dans
   l'état d'avant, comme le ROLLBACK de withTransaction. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("purge définitive et fiche par UUID", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const db = { articles: new Map(), tombstones: new Map(), failInsert: false, log: [] };
  const itemKeyOf = (doc) => doc.origin?.harvestItemId ?? null;

  async function q(sql, params = []) {
    db.log.push(sql.replace(/\s+/g, " ").trim());
    if (/FROM articles\s+WHERE status = 'purge'\s+AND decided_at </.test(sql)) {
      const cutoff = Date.parse(params[0]) - params[1] * 86400000;
      return { rows: [...db.articles.values()].filter((r) => r.doc.status === "purge" && Date.parse(r.decidedAt) < cutoff).map((r) => ({ id: r.id, doc: structuredClone(r.doc) })) };
    }
    if (/^INSERT INTO article_tombstones/.test(sql.trim())) {
      if (db.failInsert) throw new Error("panne simulée à l'écriture de la fiche");
      const cols = sql.match(/\(([^)]+)\)/)[1].split(",").map((s) => s.trim());
      const row = Object.fromEntries(cols.map((c, i) => [c, c === "decisions" || c === "meta" ? JSON.parse(params[i]) : params[i]]));
      if (!db.tombstones.has(row.id)) db.tombstones.set(row.id, row);
      return { rows: [], rowCount: 1 };
    }
    if (/^DELETE FROM articles WHERE id = ANY/.test(sql.trim())) {
      let n = 0;
      for (const id of params[0]) if (db.articles.get(id)?.doc.status === "purge" && db.articles.delete(id)) n++;
      return { rows: [], rowCount: n };
    }
    if (/^SELECT doc FROM articles WHERE uuid = \$1/.test(sql.trim())) {
      return { rows: [...db.articles.values()].filter((r) => r.doc.uuid === params[0]).map((r) => ({ doc: structuredClone(r.doc) })) };
    }
    if (/FROM articles WHERE uuid = \$1/.test(sql)) {
      return { rows: [...db.articles.values()].filter((r) => r.doc.uuid === params[0]).map((r) => ({ id: r.id, uuid: r.doc.uuid, title: r.doc.title, status: r.doc.status })) };
    }
    if (/^SELECT \* FROM article_tombstones WHERE uuid = \$1/.test(sql.trim())) {
      return { rows: [...db.tombstones.values()].filter((t) => t.uuid === params[0]).map((t) => structuredClone(t)) };
    }
    if (/SELECT item_key FROM articles/.test(sql)) {
      const keys = new Set(params[0]);
      const out = new Set();
      for (const r of db.articles.values()) if (keys.has(itemKeyOf(r.doc)) && r.doc.regenAllowed !== true) out.add(itemKeyOf(r.doc));
      for (const t of db.tombstones.values()) if (keys.has(t.item_key) && t.meta?.regenAllowed !== true) out.add(t.item_key);
      return { rows: [...out].map((item_key) => ({ item_key })) };
    }
    if (/^UPDATE articles\s+SET doc = doc \|\| jsonb_build_object\(\s*'status', 'purge'/.test(sql.trim())) {
      const [at, byId, byName, byLogin, byRole, , allowRegen] = params;
      let n = 0;
      for (const r of db.articles.values()) {
        if (r.doc.status === "purge") continue;
        r.doc = { ...r.doc, status: "purge", updatedAt: at, regenAllowed: allowRegen,
          decision: { status: "purge", at, byId, byName, byLogin, byRole, regenAllowed: allowRegen, previousStatus: r.doc.status, previous: r.doc.decision ?? null } };
        r.decidedAt = at;
        n++;
      }
      return { rows: [], rowCount: n };
    }
    if (/kv_documents/.test(sql)) return { rows: [] };
    throw new Error(`requête non simulée : ${sql.slice(0, 80)}`);
  }
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: {
      query: q,
      withTransaction: async (fn) => {
        const snap = { articles: structuredClone(db.articles), tombstones: structuredClone(db.tombstones) };
        try { return await fn({ query: q }); }
        catch (e) { db.articles = snap.articles; db.tombstones = snap.tombstones; throw e; }
      },
      closePool: async () => {}, getPool: () => ({}),
    },
  });
  mock.module(new URL("lib/journal.js", root).href, {
    namedExports: { journalRun: async () => {}, journalNotification: async () => {} },
  });

  const store = await import(new URL("lib/store.js", root).href);
  const { eraseExpiredPurges, lookupByUuid, generatedItemKeys, clearArticles, readHistory, tombstoneOf, decisionChain } = store;

  const NOW = Date.parse("2026-10-27T12:00:00.000Z");
  const daysAgo = (j) => new Date(NOW - j * 86400000).toISOString();
  const ADMIN = { status: "purge", at: daysAgo(40), byId: "u-1", byName: "Alex Admin", byLogin: "alex@lp.fr", byRole: "administrateur" };

  /* Un article qui a vécu : généré, publié, archivé, puis purgé il y a `purgedDays` jours. */
  function vecu(id, { purgedDays = 40, status = "purge", key = `s1_${id}`, regenAllowed } = {}) {
    const publie = { status: "publie", at: daysAgo(55), byId: "u-2", byName: "Rita Relectrice", byLogin: "rita@lp.fr", byRole: "relecteur" };
    const archive = { status: "archive", at: daysAgo(50), byId: null, byName: "Archivage automatique", byLogin: null, byRole: "systeme", auto: true, afterHours: 72, previousStatus: "publie", previous: publie };
    const purge = { ...ADMIN, at: daysAgo(purgedDays), previousStatus: "archive", previous: archive, ...(regenAllowed ? { regenAllowed: true } : {}) };
    const doc = {
      id, uuid: `uuid-${id}`, status, title: `Titre ${id}`, cat: "Société", mode: "official",
      createdAt: daysAgo(60), provider: "openrouter", ranking: 60,
      zone: { num: "17", dept: "Charente-Maritime", region: "Nouvelle-Aquitaine", commune: "Rochefort" },
      source: { type: "site", kind: "public", label: "Mairie de Rochefort", url: "https://rochefort.fr/a" },
      origin: { sourceId: "s1", harvestItemId: key, sourceUrl: "https://rochefort.fr/a", harvestedAt: daysAgo(61), publishedAt: daysAgo(62), rawText: "texte source" },
      publication: { publishedAt: daysAgo(55) },
      body: [{ type: "p", text: "Corps de l'article." }],
      decision: status === "purge" ? purge : archive,
      ...(regenAllowed ? { regenAllowed: true } : {}),
    };
    db.articles.set(id, { id, doc, decidedAt: doc.decision.at });
    return doc;
  }
  const reset = () => { db.articles = new Map(); db.tombstones = new Map(); db.failInsert = false; db.log = []; };

  /* Critère 1 */
  test("purgé depuis plus de t jours → fiche écrite puis article effacé ; plus récent ou non purgé : gardé", async () => {
    reset();
    vecu("a1", { purgedDays: 40 });
    vecu("a2", { purgedDays: 10 });
    vecu("a3", { status: "archive" });
    const ids = await eraseExpiredPurges({ days: 30, now: NOW });
    assert.deepEqual(ids, ["a1"]);
    assert.equal(db.articles.has("a1"), false, "effacé");
    assert.ok(db.articles.has("a2"), "purgé depuis 10 j < 30 j : gardé");
    assert.ok(db.articles.has("a3"), "un article non purgé n'est jamais effacé");
    assert.deepEqual([...db.tombstones.keys()], ["a1"]);
    const iInsert = db.log.findIndex((s) => s.startsWith("INSERT INTO article_tombstones"));
    const iDelete = db.log.findIndex((s) => s.startsWith("DELETE FROM articles"));
    assert.ok(iInsert >= 0 && iInsert < iDelete, "la fiche est écrite AVANT l'effacement");
    assert.match(db.log.find((s) => /FOR UPDATE SKIP LOCKED/.test(s)), /status = 'purge'/);
  });

  test("t = 0 (ou absent) → rien n'est effacé, aucune requête", async () => {
    reset();
    vecu("a1", { purgedDays: 400 });
    for (const days of [0, undefined, null, "", -5]) assert.deepEqual(await eraseExpiredPurges({ days, now: NOW }), []);
    assert.ok(db.articles.has("a1"));
    assert.equal(db.log.length, 0);
  });

  test("transaction : si la fiche ne s'écrit pas, rien n'est effacé", async () => {
    reset();
    vecu("a1", { purgedDays: 40 });
    db.failInsert = true;
    await assert.rejects(eraseExpiredPurges({ days: 30, now: NOW }), /panne simulée/);
    assert.ok(db.articles.has("a1"), "article intact");
    assert.equal(db.tombstones.size, 0);
  });

  /* Critère 2 */
  test("lookupByUuid : l'article vivant, puis la fiche une fois effacé (source, titre, dates, auteurs)", async () => {
    reset();
    vecu("a1", { purgedDays: 40 });
    const vivant = await lookupByUuid("uuid-a1");
    assert.equal(vivant.kind, "article");
    assert.equal(vivant.article.id, "a1");

    await eraseExpiredPurges({ days: 30, now: NOW, by: "auto" });
    const r = await lookupByUuid("uuid-a1");
    assert.equal(r.kind, "fiche");
    const f = r.fiche;
    assert.equal(f.uuid, "uuid-a1");
    assert.equal(f.title, "Titre a1");
    assert.equal(f.source_label, "Mairie de Rochefort");
    assert.equal(f.source_url, "https://rochefort.fr/a");
    assert.equal(f.item_key, "s1_a1");
    assert.equal(f.harvested_at, daysAgo(61), "récupération");
    assert.equal(f.generated_at, daysAgo(60), "génération");
    assert.equal(f.source_published_at, daysAgo(62), "parution de la source");
    assert.equal(f.published_at, daysAgo(55), "publication de l'article");
    assert.equal(f.archived_at, daysAgo(50), "archivage");
    assert.equal(f.purged_at, daysAgo(40), "purge");
    assert.equal(f.erased_at, new Date(NOW).toISOString(), "effacement");
    assert.equal(f.purged_by, "Alex Admin");
    assert.equal(f.erased_by, "auto");
    assert.equal(f.generated_by, "openrouter");
    assert.deepEqual(f.decisions.map((d) => [d.status, d.byName, d.byRole]), [
      ["publie", "Rita Relectrice", "relecteur"],
      ["archive", "Archivage automatique", "systeme"],
      ["purge", "Alex Admin", "administrateur"],
    ], "chaîne des décisions, de la plus ancienne à la plus récente");
    assert.equal("body" in f || "rawText" in f, false, "rien du texte");
    assert.equal(await lookupByUuid("inconnu"), null);
    assert.equal(await lookupByUuid(""), null);
  });

  test("decisionChain et tombstoneOf : purement à partir du document", () => {
    assert.deepEqual(decisionChain(null), []);
    const chain = decisionChain({ status: "purge", at: "t3", previousStatus: "valide", previous: { status: "valide", at: "t1", previous: null } });
    assert.deepEqual(chain, [{ status: "valide", at: "t1" }, { status: "purge", at: "t3" }]);
    const t = tombstoneOf({ id: "x", uuid: "u", decision: null }, { erasedAt: "2026-10-27T00:00:00Z", erasedBy: "alex@lp.fr" });
    assert.equal(t.published_at, null);
    assert.equal(t.purged_by, null);
    assert.equal(t.erased_by, "alex@lp.fr");
    assert.deepEqual(t.decisions, []);
  });

  /* Critère 3 (côté base ; le filtre du pipeline est dans pipelineWiring.test.js) */
  test("anti-régénération : vivant, purgé ou effacé → déjà généré ; « autoriser la régénération » le libère", async () => {
    reset();
    vecu("vivant", { status: "archive", key: "s1_v" });
    vecu("purge", { purgedDays: 2, key: "s1_p" });
    vecu("efface", { purgedDays: 40, key: "s1_e" });
    await eraseExpiredPurges({ days: 30, now: NOW });
    const keys = ["s1_v", "s1_p", "s1_e", "s1_neuf"];
    assert.deepEqual([...(await generatedItemKeys(keys))].sort(), ["s1_e", "s1_p", "s1_v"]);
    assert.deepEqual([...(await generatedItemKeys([]))], []);

    reset();
    vecu("vivant", { status: "archive", key: "s1_v" });
    await clearArticles({ rearmHarvest: false, by: { id: "u-1", name: "Alex", role: "administrateur" } });
    assert.deepEqual([...(await generatedItemKeys(["s1_v"]))], ["s1_v"], "purgé sans la case : toujours bloqué");

    reset();
    vecu("vivant", { status: "archive", key: "s1_v" });
    await clearArticles({ rearmHarvest: false, by: { id: "u-1", name: "Alex", role: "administrateur" }, allowRegen: true });
    assert.equal(db.articles.get("vivant").doc.decision.regenAllowed, true, "tracé dans la décision");
    assert.deepEqual([...(await generatedItemKeys(["s1_v"]))], [], "purgé avec la case : régénérable");
    db.articles.get("vivant").decidedAt = daysAgo(40);
    await eraseExpiredPurges({ days: 30, now: NOW });
    assert.equal(db.tombstones.get("vivant").meta.regenAllowed, true, "la fiche garde l'autorisation");
    assert.deepEqual([...(await generatedItemKeys(["s1_v"]))], [], "toujours régénérable une fois effacé");
  });

  /* Critère 4 (côté serveur ; l'écran est vérifié à part) */
  test("Historique : recherche par UUID → ligne « efface » avec la fiche ; FEAT des purgés respectée", async () => {
    reset();
    vecu("a1", { purgedDays: 40 });
    await eraseExpiredPurges({ days: 30, now: NOW });
    const h = await readHistory({ uuid: "uuid-a1", withPurged: true });
    assert.equal(h.total, 1);
    const row = h.items[0];
    assert.equal(row.status, "efface");
    assert.equal(row.uuid, "uuid-a1");
    assert.equal(row.title, "Titre a1");
    assert.equal(row.decidedBy, "Effacement automatique");
    assert.equal(row.fiche.purgedBy, "Alex Admin");
    assert.equal(row.fiche.sourceUrl, "https://rochefort.fr/a");
    assert.equal(h.nextCursor, null);

    assert.equal((await readHistory({ uuid: "uuid-a1", withPurged: false })).total, 0, "sans le droit des purgés : rien");
    vecu("a2", { status: "archive" });
    const vivant = await readHistory({ uuid: "uuid-a2", withPurged: false });
    assert.equal(vivant.items[0].status, "archive", "un article vivant se trouve aussi par UUID");
  });
}
