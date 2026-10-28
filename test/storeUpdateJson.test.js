/* M3-57 (T6) — updateJson (src/lib/store.js) sous verrou de ligne : des mises à
   jour concurrentes de la même clé, sur des connexions distinctes du pool, ne
   perdent aucune écriture. Le mock de store.js (harvestWiring) ne peut pas le
   prouver : il faut un vrai PostgreSQL, à plusieurs connexions (PGlite n'en a
   qu'une).

   Ignoré sans M3_TEST_DATABASE_URL. N'accepte qu'une base locale (localhost ou
   127.0.0.1) : jamais la base partagée. Le test crée kv_documents dans un schéma
   à lui et le supprime à la fin.

   Passe manuelle (conteneur jetable, sans volume) :
     docker run --rm -d --name m3-test-pg-b -p 127.0.0.1:<port>:5432 -e POSTGRES_PASSWORD=<mdp> postgres:16
     M3_TEST_DATABASE_URL=postgresql://postgres:<mdp>@127.0.0.1:<port>/postgres node --test test/storeUpdateJson.test.js
     docker stop m3-test-pg-b
   RÉSULTAT (2026-10-26, LP-ALSZ) : image postgres:16-alpine (celle de m3-postgres), port
   127.0.0.1:55437, mot de passe aléatoire ; 2/2 verts, 20 mises à jour concurrentes sur
   20 conservées ; conteneur arrêté, absent de `docker ps -a`. */

import test from "node:test";
import assert from "node:assert/strict";

const url = process.env.M3_TEST_DATABASE_URL;
const local = (() => { try { return ["localhost", "127.0.0.1"].includes(new URL(url).hostname); } catch { return false; } })();

if (!url || !local) {
  test("updateJson sous verrou (vraie base)", { skip: url ? "M3_TEST_DATABASE_URL n'est pas locale : refusée" : "M3_TEST_DATABASE_URL absente" }, () => {});
} else {
  const schema = `m3_test_${process.pid}`;
  const u = new URL(url);
  u.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = u.toString();
  const { query, closePool } = await import("../src/lib/db.js");
  const { updateJson, readJson } = await import("../src/lib/store.js");

  test.before(async () => {
    await query(`CREATE SCHEMA ${schema}`);
    await query(`CREATE TABLE ${schema}.kv_documents (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  });
  test.after(async () => {
    await query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await closePool();
  });

  test("20 updateJson concurrents (plusieurs connexions d'un même pool) sur une clé absente : aucune écriture perdue", async () => {
    const N = 20;
    await Promise.all(Array.from({ length: N }, (_, i) =>
      updateJson("harvest/sources-state.json", (all) => ({ ...all, [`s${i}`]: { furtif: { since: "t" } }, n: (all?.n || 0) + 1 }), {})));
    const v = await readJson("harvest/sources-state.json");
    assert.equal(v.n, N, "chaque mise à jour a vu la précédente");
    assert.equal(Object.keys(v).filter((k) => k.startsWith("s")).length, N, "aucune inscription perdue");
  });

  test("valeur de repli quand la clé n'existe pas, et valeur rendue", async () => {
    const out = await updateJson("absente", (v) => [...v, 1], []);
    assert.deepEqual(out, [1]);
    assert.deepEqual(await readJson("absente"), [1]);
  });
}
