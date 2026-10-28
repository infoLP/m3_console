/* Test des modèles du catalogue (onglet LLM, « Récupérer la liste ») — le
   moteur reçoit ses dépendances : ni base ni réseau ici. */

import test from "node:test";
import assert from "node:assert/strict";

import { modelsToTest, motifOf, runPool, runModelTests } from "../src/llm/modelTests.js";
import { ALLOWED_MODELS } from "../src/llm/allowlist.js";

test("OpenRouter (exempté) : tout le catalogue est testé ; ailleurs, la seule liste blanche", () => {
  const models = ["x/inconnu", ALLOWED_MODELS[0]];
  assert.deepEqual(modelsToTest({ id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", models }), models);
  assert.deepEqual(modelsToTest({ id: "anthropic", baseUrl: "https://api.anthropic.com/v1", models }), [ALLOWED_MODELS[0]]);
  assert.deepEqual(modelsToTest({ id: "x", baseUrl: "https://x", models: null }), []);
});

test("le motif dit d'abord si l'échec est passager ou durable", () => {
  assert.match(motifOf({ status: 429, message: "Rate limit exceeded" }), /^limite de débit atteinte \(429\) — Rate limit/);
  assert.match(motifOf({ status: 404 }), /^modèle introuvable ou retiré$/);
  assert.match(motifOf({ status: 503, message: "" }), /^fournisseur en erreur \(503\)$/);
  assert.equal(motifOf({ status: null, message: "ECONNRESET" }), "injoignable — ECONNRESET");
});

test("le pool ne dépasse jamais n appels en vol, et traite chaque élément une fois", async () => {
  let enVol = 0, max = 0;
  const vus = [];
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (i) => {
    enVol++; max = Math.max(max, enVol);
    await new Promise((r) => setTimeout(r, 5));
    vus.push(i); enVol--;
  });
  assert.equal(max, 3);
  assert.deepEqual(vus.sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test("verdicts : OK, échec HTTP avec motif, erreur réseau et délai dépassé", async () => {
  const rangés = [];
  const r = await runModelTests(["ok", "quota", "reseau", "lent"], {
    concurrency: 2,
    ping: async (m) => {
      if (m === "ok") return { ok: true, status: 200, usage: { promptTokens: 8, completionTokens: 1, totalTokens: 9, cost: 0.0001, counted: true } };
      if (m === "quota") return { ok: false, status: 429, message: "slow down" };
      if (m === "lent") throw new Error("OpenRouter : délai dépassé (30 s)");
      throw new Error("ECONNRESET");
    },
    onVerdict: async (m, v) => { rangés.push(m); },
  });
  assert.equal(r.total, 4);
  assert.equal(r.ok, 1);
  assert.equal(r.ko, 3);
  assert.equal(r.untested, 0);
  assert.equal(r.results.ok.ok, true);
  assert.match(r.results.quota.motif, /429/);
  assert.equal(r.results.lent.status, 408);
  assert.equal(r.results.reseau.status, null);
  assert.equal(r.usage.totalTokens, 9);
  assert.equal(rangés.length, 4);
});

test("plafond atteint : le test s'arrête, les modèles restants sont « non testés »", async () => {
  const appels = [];
  const r = await runModelTests(["a", "b", "c", "d", "e"], {
    concurrency: 1,
    ping: async (m) => { appels.push(m); return { ok: true, status: 200, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 10, cost: null, counted: true } }; },
    capHit: async (used) => (used.totalTokens >= 20 ? { detail: "plafond de la run atteint" } : null),
  });
  assert.deepEqual(appels, ["a", "b"]);
  assert.equal(r.untested, 3);
  assert.equal(r.stopped, "plafond de la run atteint");
});
