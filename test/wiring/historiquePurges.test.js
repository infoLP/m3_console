/* M3-97 — sous le seuil de la FEAT, les purgés ne quittent pas la base : la
   requête de readHistory (src/lib/store.js) ne les lit ni en lignes, ni au
   total, ni dans les compteurs. Base simulée par `mock.module` : `npm test`
   saute ce fichier, `npm run test:wiring` le lance. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("purgés de l'Historique filtrés par la requête", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const calls = [];
  /* Les statuts demandés sont le premier paramètre de chaque requête ; on
     répond comme une base qui contiendrait un article de chaque statut. */
  const q = async (sql, params = []) => {
    calls.push({ sql, params });
    const statuses = params[0] || [];
    if (/GROUP BY status/.test(sql)) return { rows: statuses.map((status) => ({ status, n: 1 })) };
    if (/count\(\*\)/.test(sql)) return { rows: [{ n: statuses.length }] };
    return { rows: [] };
  };
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  mock.module(new URL("lib/journal.js", root).href, {
    namedExports: { journalRun: async () => {}, journalNotification: async () => {} },
  });

  const { readHistory } = await import(new URL("lib/store.js", root).href);

  test("M3-97 — sans le droit : aucun « purge » dans les trois requêtes, ni dans les compteurs", async () => {
    calls.length = 0;
    const h = await readHistory({ withPurged: false });
    assert.equal(calls.length, 3);
    for (const c of calls) assert.ok(!c.params[0].includes("purge"), c.sql);
    assert.equal("purge" in h.counts, false);
    assert.deepEqual(Object.keys(h.counts).sort(), ["archive", "publie", "valide"]);
  });

  test("M3-97 — sans le droit, la catégorie « purge » demandée ne la réintroduit pas", async () => {
    calls.length = 0;
    await readHistory({ withPurged: false, category: "purge" });
    for (const c of calls) assert.ok(!c.params.includes("purge"), c.sql);
  });

  test("M3-97 — avec le droit (défaut) : les purgés restent, filtre compris", async () => {
    calls.length = 0;
    const h = await readHistory({ category: "purge" });
    assert.ok(calls[0].params[0].includes("purge"));
    assert.ok(calls.some((c) => c.params.includes("purge") && /status = \$/.test(c.sql)));
    assert.equal(h.counts.purge, 1);
  });
}
