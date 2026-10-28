/* Garde-fous des appels LLM — M3-60, M3-61, M3-64, M3-65.

   Tout est exercé SANS clé d'API : les fonctions de bornes sont pures, et les
   deux adaptateurs sont appelés avec un `fetch` de substitution. C'est ce qui
   permet de tenir ces invariants avant M3-48, et de les garder ensuite : un
   max_tokens qu'on retirerait du corps ferait tomber un test, pas seulement une
   facture.

   Plusieurs cas ci-dessous sont nés d'une revue qui a trouvé de vrais défauts
   dans la première mouture — lecture du corps hors délai, coût illisible compté
   pour zéro, `Retry-After` négatif faisant rejouer aussitôt. Ils sont là pour
   que ces défauts ne reviennent pas. */

import test from "node:test";
import assert from "node:assert/strict";

import { retryDelayMs, parseRetryAfter, readUsage, emptyUsage, newUsageTotal, addUsage } from "../src/llm/limits.js";
import { redact } from "../src/lib/redact.js";
import * as openaiCompat from "../src/llm/openaiCompat.js";
import * as anthropic from "../src/llm/anthropic.js";

/* --- installation d'un fetch de substitution -------------------------------- */

/* `calls` enregistre chaque requête émise (url + corps décodé) ; `plan` est la
   suite des réponses à servir, une par tentative. */
function stubFetch(plan) {
  const calls = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} });
    const step = plan[Math.min(i, plan.length - 1)];
    i++;
    if (typeof step === "function") return step(init);
    return step;
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/* Une réponse HTTP minimale — juste ce que `fetchBounded` lit. */
function reply(status, payload, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null },
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  };
}

const okChat = (content, usage) => reply(200, {
  choices: [{ message: { content } }],
  ...(usage ? { usage } : {}),
});

/* Anthropic ne répond pas en `choices` : le corps arrive en blocs `content`, et
   l'accolade d'amorce est recollée par l'adaptateur — d'où le `"ok":true}` sans
   accolade ouvrante. */
const okChatAnthropic = (tail = '"ok":true}', usage) => reply(200, {
  content: [{ type: "text", text: tail }],
  ...(usage ? { usage } : {}),
});

/* Clés factices, mais de longueur réaliste : `redact` exige seize caractères
   après le préfixe, exprès, pour ne pas masquer l'empreinte « sk-or…abcd »
   affichée au back-office. Une clé jouet trop courte ne prouverait donc rien. */
const FAUSSE_CLE_OR = "sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const OPENROUTER = { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKey: FAUSSE_CLE_OR, defaultModel: "mistralai/mistral-small-2603" };
const OPENAI = { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-proj-0123456789abcdef0123456789abcdef", defaultModel: "gpt-4o-mini" };
const CLAUDE = { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant-0123456789abcdef0123456789abcdef", defaultModel: "claude-sonnet-5" };

/* --- M3-65 : attente avant la seconde tentative ----------------------------- */

test("le délai croît au lieu de rejouer aussitôt", () => {
  assert.equal(retryDelayMs(0, null), 1000);
  assert.equal(retryDelayMs(1, null), 2000);
  assert.equal(retryDelayMs(2, null), 4000);
});

test("Retry-After en secondes prime sur le délai deviné", () => {
  assert.equal(retryDelayMs(0, "3"), 3000);
  assert.equal(retryDelayMs(0, "0"), 0);
});

test("Retry-After sous forme de date HTTP est compris", () => {
  const dans5s = new Date(Date.now() + 5000).toUTCString();
  const d = parseRetryAfter(dans5s);
  assert.ok(d > 3500 && d <= 5000, `délai inattendu : ${d}`);
});

test("une date Retry-After déjà passée ne donne pas un délai négatif", () => {
  assert.equal(parseRetryAfter(new Date(Date.now() - 60000).toUTCString()), 0);
});

test("un Retry-After illisible retombe sur le délai croissant", () => {
  assert.equal(parseRetryAfter("bientôt"), null);
  assert.equal(retryDelayMs(1, "bientôt"), 2000);
});

test("un Retry-After négatif ou fusionné ne fait pas rejouer aussitôt", () => {
  /* `Date.parse` accepte « -5 » et « 5, 10 » comme des dates passées, donc comme
     une attente nulle : on rejouait dans la même fenêtre de limitation, sans
     attendre. C'est le défaut que M3-65 ferme, et il était revenu par la porte
     de derrière. Un vrai Retry-After daté commence par un jour de semaine. */
  assert.equal(parseRetryAfter("-5"), null);
  assert.equal(parseRetryAfter("+5"), null);
  assert.equal(parseRetryAfter("5, 10"), null, "deux en-têtes fusionnés par un proxy");
  assert.equal(retryDelayMs(0, "-5"), 1000, "on retombe sur le délai croissant");
});

test("sur 429, l'appel attend puis rejoue et réussit", async () => {
  const s = stubFetch([
    reply(429, { error: { message: "rate limited" } }, { "retry-after": "0" }),
    okChat('{"ok":true}'),
  ]);
  try {
    const out = await openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 5000 });
    assert.deepEqual(out, { ok: true });
    assert.equal(s.calls.length, 2, "il faut bien deux tentatives");
  } finally { s.restore(); }
});

test("l'attente sur 429 a réellement lieu", async () => {
  /* Le test ci-dessus passerait encore si le `await` disparaissait : avec
     Retry-After: 0, on ne mesure rien. Celui-ci coûte une seconde de suite de
     tests, et c'est le prix pour que M3-65 soit tenu et pas seulement écrit. */
  const s = stubFetch([
    reply(429, { error: { message: "rate limited" } }, { "retry-after": "1" }),
    okChat('{"ok":true}'),
  ]);
  try {
    const t0 = Date.now();
    await openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 5000 });
    const ecoule = Date.now() - t0;
    assert.ok(ecoule >= 900, `rejoué après ${ecoule} ms : la fenêtre de limitation n'a pas bougé`);
  } finally { s.restore(); }
});

test("une attente plus longue que le budget annule le rejeu au lieu de bloquer", async () => {
  /* Le plafond n'écrête pas, il fait renoncer : attendre 20 s un fournisseur qui
     a demandé 10 minutes, c'est immobiliser la run pour rejouer dans une fenêtre
     que rien ne garantit rouverte. Le repli mock vaut mieux. */
  const s = stubFetch([reply(429, { error: { message: "rate limited" } }, { "retry-after": "600" })]);
  try {
    const t0 = Date.now();
    await assert.rejects(
      () => openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 5000 }),
      /HTTP 429/
    );
    assert.equal(s.calls.length, 1, "aucune seconde tentative");
    assert.ok(Date.now() - t0 < 1000, "et surtout : on n'a pas attendu");
  } finally { s.restore(); }
});

test("deux 429 de suite échouent au lieu de boucler", async () => {
  const s = stubFetch([reply(429, { error: { message: "rate limited" } }, { "retry-after": "0" })]);
  try {
    await assert.rejects(
      () => openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 5000 }),
      /HTTP 429/
    );
    assert.equal(s.calls.length, 2, "exactement deux tentatives, pas davantage");
  } finally { s.restore(); }
});

test("le dialecte Anthropic rejoue aussi sur 429", async () => {
  const s = stubFetch([
    reply(429, { error: { message: "rate limited" } }, { "retry-after": "0" }),
    okChatAnthropic(),
  ]);
  try {
    const out = await anthropic.chat(CLAUDE, "sys", "usr", { timeoutMs: 5000 });
    assert.deepEqual(out, { ok: true });
    assert.equal(s.calls.length, 2);
  } finally { s.restore(); }
});

/* --- M3-60 : plafond de sortie ---------------------------------------------- */

test("le dialecte OpenAI envoie max_tokens", async () => {
  const s = stubFetch([okChat('{"ok":true}')]);
  try {
    await openaiCompat.chat(OPENROUTER, "sys", "usr", { maxTokens: 1234, timeoutMs: 5000 });
    assert.equal(s.calls[0].body.max_tokens, 1234);
  } finally { s.restore(); }
});

test("le dialecte Anthropic prend la même valeur, plus son 4096 en dur", async () => {
  const s = stubFetch([okChatAnthropic()]);
  try {
    await anthropic.chat(CLAUDE, "sys", "usr", { maxTokens: 1234, timeoutMs: 5000 });
    assert.equal(s.calls[0].body.max_tokens, 1234);
  } finally { s.restore(); }
});

test("sans valeur passée, les deux dialectes plafonnent quand même", async () => {
  /* Un appel direct qui oublierait l'option ne doit pas repartir sans borne :
     c'est précisément l'état d'avant M3-60. */
  for (const [adapter, provider, ok] of [
    [openaiCompat, OPENROUTER, okChat('{"ok":true}')],
    [anthropic, CLAUDE, okChatAnthropic()],
  ]) {
    const s = stubFetch([ok]);
    try {
      await adapter.chat(provider, "sys", "usr", { timeoutMs: 5000 });
      assert.equal(s.calls[0].body.max_tokens, 4096, `${provider.label} sans plafond`);
    } finally { s.restore(); }
  }
});

/* --- M3-61 : relevé d'usage -------------------------------------------------- */

test("usage: { include: true } ne part QUE chez OpenRouter", async () => {
  /* L'API OpenAI refuse en 400 un paramètre qu'elle ne connaît pas : envoyer
     cette extension à tout le monde casserait OpenAI, Mistral et Ollama. */
  const a = stubFetch([okChat('{"ok":true}')]);
  try {
    await openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 5000 });
    assert.deepEqual(a.calls[0].body.usage, { include: true });
  } finally { a.restore(); }

  const b = stubFetch([okChat('{"ok":true}')]);
  try {
    await openaiCompat.chat(OPENAI, "sys", "usr", { timeoutMs: 5000 });
    assert.equal(b.calls[0].body.usage, undefined);
  } finally { b.restore(); }
});

test("les tokens et le coût remontent par onUsage", async () => {
  const seen = [];
  const s = stubFetch([okChat('{"ok":true}', { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00042 })]);
  try {
    await openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 5000, onUsage: (u) => seen.push(u) });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].promptTokens, 120);
    assert.equal(seen[0].completionTokens, 30);
    assert.equal(seen[0].totalTokens, 150);
    assert.equal(seen[0].cost, 0.00042);
    assert.equal(seen[0].counted, true);
  } finally { s.restore(); }
});

test("la convention Anthropic input/output_tokens est comprise", () => {
  const u = readUsage({ input_tokens: 80, output_tokens: 20 });
  assert.equal(u.promptTokens, 80);
  assert.equal(u.completionTokens, 20);
  assert.equal(u.totalTokens, 100, "le total se déduit quand il n'est pas donné");
  assert.equal(u.cost, null, "Anthropic ne renvoie pas de coût");
});

test("un coût absent n'est pas un coût nul", () => {
  assert.equal(readUsage({ prompt_tokens: 1 }).cost, null);
  assert.equal(readUsage({ prompt_tokens: 1, cost: 0 }).cost, 0);
});

test("un coût illisible vaut inconnu, jamais zéro", () => {
  /* OpenRouter renvoie une chaîne vide sur certains modèles gratuits. Le lire
     comme 0 afficherait « coût : 0 € » au lieu de « coût inconnu », et un futur
     plafond de dépense nourri de zéros ne se déclencherait jamais. */
  for (const mauvais of ["", "abc", -3, NaN, {}, []]) {
    assert.equal(readUsage({ prompt_tokens: 1, cost: mauvais }).cost, null,
      `cost=${JSON.stringify(mauvais)} devrait valoir inconnu`);
  }
});

test("un compteur illisible ne passe pas pour un relevé à zéro", () => {
  const u = readUsage({ prompt_tokens: "abc", completion_tokens: null });
  assert.equal(u.counted, false, "la présence de la clé ne suffit pas, il faut qu'elle soit lisible");
  assert.equal(u.promptTokens, 0);
});

test("un usage absent se distingue d'un usage à zéro", () => {
  assert.equal(readUsage(undefined).counted, false);
  assert.equal(readUsage({ prompt_tokens: 0, completion_tokens: 0 }).counted, true);
});

test("aucune valeur aberrante ne produit de NaN dans les totaux", () => {
  const t = newUsageTotal();
  for (const mauvais of [{ prompt_tokens: "x" }, { input_tokens: null }, { total_tokens: NaN },
                         { prompt_tokens: -1 }, { completion_tokens: [] }, { prompt_tokens: {} }]) {
    addUsage(t, readUsage(mauvais));
  }
  for (const k of ["promptTokens", "completionTokens", "totalTokens"]) {
    assert.ok(Number.isFinite(t[k]), `${k} = ${t[k]}`);
  }
  assert.equal(t.cost, null);
});

test("le total d'une run additionne les appels sans confondre inconnu et gratuit", () => {
  const t = newUsageTotal();
  addUsage(t, readUsage({ prompt_tokens: 10, completion_tokens: 5, cost: 0.001 }));
  addUsage(t, readUsage({ prompt_tokens: 20, completion_tokens: 5, cost: 0.002 }));
  addUsage(t, emptyUsage());   // un appel dont rien n'a été relevé
  assert.equal(t.billedCalls, 3);
  assert.equal(t.promptTokens, 30);
  assert.equal(t.completionTokens, 10);
  assert.equal(t.totalTokens, 40, "15 + 25 : le total se déduit appel par appel");
  assert.ok(Math.abs(t.cost - 0.003) < 1e-9);
  assert.equal(t.uncounted, 1, "l'appel non relevé doit rester visible");
});

test("un seul coût illisible ne fait pas basculer le total à zéro", () => {
  const t = newUsageTotal();
  addUsage(t, readUsage({ prompt_tokens: 10, cost: "" }));
  assert.equal(t.cost, null, "le total reste inconnu");
});

test("sans aucun coût rapporté, le total reste inconnu et non zéro", () => {
  const t = newUsageTotal();
  addUsage(t, readUsage({ input_tokens: 10, output_tokens: 2 }));
  assert.equal(t.cost, null);
});

/* --- M3-64 : borne de temps --------------------------------------------------- */

test("un fournisseur muet est coupé, avec un message qui le dit", async () => {
  /* Le stub respecte le signal : c'est exactement ce que fait fetch quand
     l'AbortController se déclenche. Sans AbortSignal, cette promesse ne se
     résoudrait jamais — c'est le défaut que M3-64 corrige. */
  const s = stubFetch([(init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => {
      reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
    });
  })]);
  try {
    await assert.rejects(
      () => openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 50 }),
      /délai dépassé \(0 s\)/
    );
  } finally { s.restore(); }
});

test("le délai couvre AUSSI la lecture du corps, pas seulement les en-têtes", async () => {
  /* `fetch` résout dès les en-têtes. Désarmer le minuteur à ce moment-là laissait
     la lecture du corps sans borne : un « 200 OK » suivi d'un corps qui n'arrive
     jamais figeait le run aussi sûrement qu'avant M3-64, et le repli mock n'avait
     jamais l'occasion de prendre la main. Défaut réel, trouvé en revue. */
  const s = stubFetch([(init) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  })]);
  try {
    const t0 = Date.now();
    await assert.rejects(
      () => openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 150 }),
      /délai dépassé/
    );
    assert.ok(Date.now() - t0 < 2000, "l'appel doit rendre la main, pas se figer");
  } finally { s.restore(); }
});

test("le délai borne chaque tentative, pas leur somme", async () => {
  /* Une première tentative qui consomme presque tout le budget ne doit pas faire
     avorter la seconde d'entrée de jeu. Le stub refuse un signal déjà avorté :
     avec un contrôleur PARTAGÉ entre les tentatives, armé à 300 ms, la seconde
     partirait après l'attente d'une seconde et échouerait — ce test-ci le verrait,
     là où la version précédente passait dans les deux cas. */
  const s = stubFetch([
    (init) => init.signal.aborted
      ? Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      : reply(500, { error: { message: "boom" } }),
    (init) => init.signal.aborted
      ? Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      : okChatAnthropic(),
  ]);
  try {
    const out = await anthropic.chat(CLAUDE, "sys", "usr", { timeoutMs: 300 });
    assert.deepEqual(out, { ok: true }, "la seconde tentative doit avoir son propre budget");
    assert.equal(s.calls.length, 2);
  } finally { s.restore(); }
});

test("listModels est borné lui aussi", async () => {
  const s = stubFetch([(init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  })]);
  try {
    await assert.rejects(
      () => openaiCompat.listModels(OPENROUTER, { timeoutMs: 50 }),
      /délai dépassé/
    );
  } finally { s.restore(); }
});

test("une réponse non-JSON donne un message qui dit d'où elle vient", async () => {
  /* Une page d'erreur HTML de proxy remontait en « Unexpected token < », qui ne
     nomme ni le fournisseur ni le contenu reçu. */
  const s = stubFetch([reply(200, "<html>502 Bad Gateway</html>")]);
  try {
    await assert.rejects(
      () => openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 5000 }),
      /OpenRouter : réponse illisible/
    );
  } finally { s.restore(); }
});

/* --- la clé ne fuit jamais ---------------------------------------------------- */

test("le message de dépassement de délai ne porte aucun secret", async () => {
  const s = stubFetch([(init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  })]);
  try {
    await openaiCompat.chat(OPENROUTER, "sys", "usr", { timeoutMs: 50 });
    assert.fail("aurait dû échouer");
  } catch (err) {
    assert.ok(!err.message.includes(OPENROUTER.apiKey), `la clé fuit : ${err.message}`);
    assert.ok(!err.message.includes("sk-"), `un préfixe de clé fuit : ${err.message}`);
  } finally { s.restore(); }
});

test("un fournisseur qui renvoie la clé en écho est masqué avant d'être journalisé", () => {
  /* Cas réel : une API renvoie l'en-tête d'authentification reçu dans son message
     d'erreur. Ce message part en notification, en base et au journal. */
  const echo = `OpenRouter HTTP 401 {"error":{"message":"Invalid auth: Bearer ${OPENROUTER.apiKey}"}}`;
  const masque = redact(echo);
  assert.ok(!masque.includes(OPENROUTER.apiKey), `la clé traverse redact : ${masque}`);
});
