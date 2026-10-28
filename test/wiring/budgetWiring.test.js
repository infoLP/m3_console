/* M3-62 — branchement du plafond de dépense dans src/llm/index.js : refus AVANT
   le réseau en action « stop », repli compté en action « mock », report de
   chaque appel payé au registre, plafond du mois lu sur ce registre.

   La base, le moteur et le fournisseur sont simulés par `mock.module`, encore
   expérimental : il faut `--experimental-test-module-mocks` (Node ≥ 22.3).
   `npm test` ne le passe pas — engines annonce Node 20 — et ce fichier se saute
   alors lui-même. Le lancer : `npm run test:budget`. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("branchement du plafond LLM", { skip: "lancer `npm run test:budget` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  let settings = {};
  let ledger = null;
  let recorded = 0;
  let calls = 0;

  mock.module(new URL("lib/llmProviders.js", root).href, {
    namedExports: {
      activeProvider: async () => ({ id: "openrouter", label: "OpenRouter", kind: "openai", apiKey: "k", defaultModel: "m", baseUrl: "https://openrouter.ai/api/v1" }),
      // moteur de secours (M3-88) : aucun n'est réglé ici
      readProviderWithKey: async () => null,
      // prompts du back-office (M3-56) : aucun, le prompt par défaut du code s'applique
      readCurrentPrompts: async () => [],
    },
  });
  const real = await import(new URL("lib/yamlStore.js", root).href);
  mock.module(new URL("lib/yamlStore.js", root).href, {
    namedExports: { SETTING_SPECS: real.SETTING_SPECS, readSettings: async () => ({ llm_max_tokens: 4096, llm_timeout_ms: 1000, ...settings }) },
  });
  mock.module(new URL("llm/allowlist.js", root).href, { namedExports: { resolveAllowedModel: () => "m" } });
  mock.module(new URL("lib/store.js", root).href, { namedExports: { readJson: async () => ledger } });
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: {
      withTransaction: async (fn) => fn({ query: async (sql, p) => {
        if (sql.startsWith("SELECT")) return { rows: [{ value: ledger }] };
        if (sql.startsWith("UPDATE")) { ledger = JSON.parse(p[1]); recorded++; }
        return { rows: [] };
      } }),
    },
  });

  /* Chaque appel coûte 0,40 $ et 200 tokens. */
  globalThis.fetch = async () => {
    calls++;
    const content = JSON.stringify({ score: 0.1, verdict: "ok", spans: [] });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, cost: 0.4 },
    }), { status: 200 });
  };

  const llm = await import(new URL("llm/index.js", root).href);
  const call = () => llm.checkPlagiarism("source", "article");

  test("stop : refus avant le réseau une fois le plafond de run atteint", async () => {
    settings = { llm_cap_run_usd: 1 }; ledger = null; recorded = 0; calls = 0;
    await llm.resetLlmStats();
    await call(); await call();
    await call(); // 0,80 $ < 1 $ : passe, et dépasse — d'un appel au plus
    await assert.rejects(call(), (e) => e.code === "LLM_CAP" && e.status === 429);
    assert.equal(calls, 3);
    assert.equal(llm.llmStats.fallbacks, 0, "un arrêt n'est pas un repli");
    assert.equal(llm.llmStats.capHit.scope, "run");
    assert.equal(recorded, 3, "chaque appel payé est reporté au registre");
  });

  test("mock : au plafond, repli compté (capped et fallbacks), sans réseau ni erreur fournisseur", async () => {
    settings = { llm_cap_run_usd: 0.5, llm_cap_action: "mock" }; ledger = null; calls = 0;
    await llm.resetLlmStats();
    await call(); await call(); await call();
    assert.equal(calls, 2);
    assert.equal(llm.llmStats.capped, 1);
    assert.equal(llm.llmStats.fallbacks, 1);
    assert.equal(llm.llmStats.lastError, null, "le plafond n'est pas une panne");
  });

  test("le plafond du mois se lit sur le registre, d'une run à l'autre", async () => {
    // registre laissé par le test précédent : 2 appels à 0,40 $ = 0,80 $ ce mois
    settings = { llm_cap_month_usd: 0.8 }; calls = 0;
    await llm.resetLlmStats();
    await assert.rejects(call(), (e) => e.cap.scope === "month");
    assert.equal(calls, 0);
  });

  test("sans plafond, la dépense est quand même reportée au registre", async () => {
    settings = {}; ledger = null; recorded = 0;
    await llm.resetLlmStats();
    await call();
    assert.equal(recorded, 1);
  });
}
