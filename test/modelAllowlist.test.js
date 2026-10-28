/* Liste blanche des modèles LLM — M3-63.

   Exercée sans base ni réseau : la liste et sa vérification sont pures. Le
   câblage (génération, test de connexion, enregistrement au back-office)
   s'appuie sur ces deux fonctions et sur rien d'autre. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ALLOWED_MODELS, allowlistApplies, isModelAllowed, isModelAllowedFor, isModelSavable, resolveAllowedModel,
} from "../src/llm/allowlist.js";

const REF = "mistralai/mistral-small-2603";
const provider = (defaultModel) => ({ id: "openrouter", label: "OpenRouter", defaultModel });

test("liste blanche : l'identifiant exact passe", () => {
  assert.ok(ALLOWED_MODELS.length > 0);
  for (const m of ALLOWED_MODELS) assert.equal(isModelAllowed(m), true);
});

/* Le ticket naît d'« un caractère de trop » : chacune de ces variantes est une
   faute de frappe plausible, et aucune ne doit passer. */
test("liste blanche : comparaison exacte — ni casse, ni espace, ni préfixe, ni joker", () => {
  for (const m of [
    `${REF} `, ` ${REF}`, REF.toUpperCase(), `${REF}x`, REF.slice(0, -1),
    "mistralai/mistral-small", "mistralai/*", "mistralai/mistral-large-2411", "",
  ]) {
    assert.equal(isModelAllowed(m), false, `« ${m} » ne devait pas passer`);
  }
});

test("liste blanche : une valeur qui n'est pas une chaîne est refusée", () => {
  for (const m of [null, undefined, 0, [REF], { id: REF }]) assert.equal(isModelAllowed(m), false);
});

test("liste blanche : la liste ne se modifie pas à l'exécution", () => {
  assert.ok(Object.isFrozen(ALLOWED_MODELS));
  assert.throws(() => ALLOWED_MODELS.push("openai/gpt-4o"));
  assert.equal(isModelAllowed("openai/gpt-4o"), false);
});

test("résolution : le modèle par défaut autorisé est rendu tel quel", () => {
  assert.equal(resolveAllowedModel(provider(REF)), REF);
});

test("résolution : un modèle par défaut hors liste est refusé, avec un code reconnaissable", () => {
  assert.throws(() => resolveAllowedModel(provider(`${REF} `)), (err) =>
    err.code === "MODEL_NOT_ALLOWED" && err.status === 400 && /hors liste blanche/.test(err.message));
});

/* Le contournement que la résolution unique ferme : un moteur au modèle par
   défaut irréprochable, et un modèle demandé par l'appelant qui ne l'est pas.
   C'est le modèle demandé qui partirait sur le réseau — c'est donc lui qu'on
   contrôle. Chemin ouvert par M3-55 (choix du modèle par run). */
test("résolution : un modèle demandé hors liste est refusé même si le défaut est autorisé", () => {
  assert.throws(() => resolveAllowedModel(provider(REF), "anthropic/claude-opus-4"), { code: "MODEL_NOT_ALLOWED" });
});

test("résolution : le modèle demandé prime sur le défaut, comme dans les adaptateurs", () => {
  assert.equal(resolveAllowedModel(provider("pas-autorise"), REF), REF);
});

test("résolution : aucun modèle du tout reste l'erreur d'avant, pas un refus de liste blanche", () => {
  assert.throws(() => resolveAllowedModel(provider(null)), (err) =>
    /Aucun modèle choisi/.test(err.message) && err.code !== "MODEL_NOT_ALLOWED");
});

/* Une installation neuve doit produire de vrais articles sans toucher à la
   liste : le modèle que la migration 006 pose par défaut doit y figurer. Sinon
   la liste blanche ferait retomber toute installation de référence sur le mock. */
test("liste blanche : le modèle par défaut de la migration 006 est autorisé", async () => {
  const sql = await readFile(new URL("../migrations/006_llm_providers.sql", import.meta.url), "utf8");
  const seeded = sql.match(/\('openrouter',[^)]*'([^']+\/[^']+)'/);
  assert.ok(seeded, "modèle par défaut d'OpenRouter introuvable dans la migration 006");
  assert.equal(isModelAllowed(seeded[1]), true, `${seeded[1]} absent de la liste blanche`);
});

/* ------------------------------------------- exemption d'OpenRouter — M3-68 */

const OR = { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" };
const HORS_LISTE = "mistralai/mistral-small-2603-batch";

/* Le réglage est lu à chaque appel : chaque test le pose ou le retire lui-même,
   et le remet comme il l'a trouvé. */
function withEnv(value, fn) {
  const before = process.env.M3_LLM_ALLOWLIST_OPENROUTER;
  if (value === undefined) delete process.env.M3_LLM_ALLOWLIST_OPENROUTER;
  else process.env.M3_LLM_ALLOWLIST_OPENROUTER = value;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.M3_LLM_ALLOWLIST_OPENROUTER;
    else process.env.M3_LLM_ALLOWLIST_OPENROUTER = before;
  }
}

test("exemption : un moteur dont l'URL est celle d'OpenRouter échappe à la liste", () => withEnv(undefined, () => {
  assert.equal(allowlistApplies(OR), false);
  assert.equal(isModelAllowedFor(OR, HORS_LISTE), true);
  assert.equal(resolveAllowedModel({ ...OR, defaultModel: HORS_LISTE }), HORS_LISTE);
  /* Le modèle demandé par l'appelant suit la même règle que le défaut. */
  assert.equal(resolveAllowedModel({ ...OR, defaultModel: "mistralai/mistral-small-2603" }, HORS_LISTE), HORS_LISTE);
}));

/* C'est l'URL qui décide où part l'appel : le nom ou l'identifiant du moteur,
   libres au back-office, ne doivent rien exempter. */
test("exemption : ni le nom ni l'identifiant du moteur ne suffisent", () => withEnv(undefined, () => {
  for (const baseUrl of [
    "https://api.mistral.ai/v1", "https://api.anthropic.com", undefined, null, "",
  ]) {
    const p = { id: "openrouter", label: "OpenRouter", baseUrl };
    assert.equal(allowlistApplies(p), true, `${baseUrl} ne devait pas être exempté`);
    assert.throws(() => resolveAllowedModel({ ...p, defaultModel: HORS_LISTE }), { code: "MODEL_NOT_ALLOWED" });
  }
}));

test("exemption : hôte comparé à l'exact, HTTPS exigé, URL illisible = liste appliquée", () => withEnv(undefined, () => {
  for (const baseUrl of [
    "http://openrouter.ai/api/v1",            // pas de TLS
    "https://openrouter.ai.exemple.com/v1",   // suffixe
    "https://exemple.com/openrouter.ai",      // dans le chemin
    "https://faux-openrouter.ai/v1",          // préfixe
    "https://api.openrouter.ai/v1",           // sous-domaine : pas l'hôte des guardrails connus
    "openrouter.ai/api/v1",                   // pas une URL
    "https://openrouter.ai@exemple.com/v1",   // identifiants : l'hôte réel est exemple.com
  ]) {
    assert.equal(allowlistApplies({ baseUrl }), true, `${baseUrl} ne devait pas être exempté`);
  }
  /* La casse de l'hôte, elle, est normalisée par URL : c'est le même serveur. */
  assert.equal(allowlistApplies({ baseUrl: "https://OpenRouter.ai/api/v1" }), false);
}));

test("exemption : M3_LLM_ALLOWLIST_OPENROUTER=1 réactive la liste pour OpenRouter", () => {
  withEnv("1", () => {
    assert.equal(allowlistApplies(OR), true);
    assert.throws(() => resolveAllowedModel({ ...OR, defaultModel: HORS_LISTE }), { code: "MODEL_NOT_ALLOWED" });
    assert.equal(resolveAllowedModel({ ...OR, defaultModel: "mistralai/mistral-small-2603" }), "mistralai/mistral-small-2603");
  });
});

/* Un réglage de sécurité échoue du côté prudent : toute valeur non vide filtre,
   y compris celles qu'un exploitant écrit en croyant dire « oui ». Seul le vide
   (ou des espaces) laisse l'exemption. */
test("exemption : toute valeur non vide du réglage réactive la liste", () => {
  for (const v of ["1 ", "1\r", "true", "yes", "oui", "0"]) {
    withEnv(v, () => assert.equal(allowlistApplies(OR), true, `« ${JSON.stringify(v)} » devait filtrer`));
  }
  for (const v of [undefined, "", "  "]) {
    withEnv(v, () => assert.equal(allowlistApplies(OR), false, `« ${JSON.stringify(v)} » devait exempter`));
  }
});

/* ------------------------------------------ enregistrement au back-office */

const STORED_OR = { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "mistralai/mistral-small-2603" };
const STORED_ANT = { baseUrl: "https://api.anthropic.com/v1", defaultModel: "mistralai/mistral-small-2603" };

test("enregistrement : modèle hors liste accepté sur OpenRouter, refusé ailleurs", () => withEnv(undefined, () => {
  assert.equal(isModelSavable({ defaultModel: HORS_LISTE }, STORED_OR), true);
  assert.equal(isModelSavable({ defaultModel: HORS_LISTE }, STORED_ANT), false);
}));

/* Le cas que la relecture du 2026-10-12 a désigné : l'URL et le modèle changent
   dans le MÊME envoi. C'est l'URL d'après qui compte, dans les deux sens. */
test("enregistrement : l'URL du patch prime sur celle en base", () => withEnv(undefined, () => {
  assert.equal(isModelSavable({ baseUrl: "https://api.anthropic.com/v1", defaultModel: HORS_LISTE }, STORED_OR), false,
    "quitter OpenRouter en choisissant un modèle hors liste devait être refusé");
  assert.equal(isModelSavable({ baseUrl: "https://openrouter.ai/api/v1", defaultModel: HORS_LISTE }, STORED_ANT), true);
}));

test("enregistrement : un modèle hérité inchangé reste enregistrable (règle de M3-63)", () => withEnv(undefined, () => {
  const herite = { baseUrl: "https://api.anthropic.com/v1", defaultModel: HORS_LISTE };
  assert.equal(isModelSavable({ baseUrl: herite.baseUrl, defaultModel: HORS_LISTE }, herite), true);
  assert.equal(isModelSavable({ defaultModel: `${HORS_LISTE}x` }, herite), false);
}));

test("enregistrement : sans modèle dans le patch, rien à juger", () => withEnv(undefined, () => {
  for (const p of [{}, { defaultModel: null }, { defaultModel: "" }, { defaultModel: "  " }]) {
    assert.equal(isModelSavable(p, STORED_ANT), true);
  }
}));

/* Garde de câblage : les fonctions ci-dessus sont pures, et leurs appelants
   touchent la base ou le réseau. Une régression qui remettrait le contrôle
   d'avant M3-68 (isModelAllowed seul) dans l'un des trois points de contrôle
   passerait tous les tests sans ce relevé du source. */
test("câblage : les trois points de contrôle tiennent compte de l'exemption", async () => {
  const src = (p) => readFile(new URL(`../src/${p}`, import.meta.url), "utf8");
  const [api, index, providers] = await Promise.all([src("api/llm.js"), src("llm/index.js"), src("lib/llmProviders.js")]);
  /* T20c : le test de connexion est fait par le moteur (demande test_llm, qui
     applique isModelAllowedFor : M3 src/jobs/taches/test_llm.js, test/llmTaches.test.js).
     La console dépose la demande ; elle ne doit pas revenir au contrôle seul. */
  assert.match(api, /demander\("test_llm"/, "test de connexion : déposé au moteur");
  assert.doesNotMatch(api, /[^.\w]isModelAllowed\(/, "test de connexion : isModelAllowed seul");
  /* `engine` depuis M3-88 : le moteur qui sert l'appel (principal, secours, relecture). */
  assert.match(index, /resolveAllowedModel\(engine, opts\.model\)/, "appel de génération");
  assert.match(providers, /isModelSavable\(patch, /, "enregistrement");
  assert.match(providers, /modelAllowed: isModelAllowedFor\(r, r\.defaultModel\)/, "affichage");
});

test("exemption : un modèle vide ou qui n'est pas une chaîne reste refusé", () => withEnv(undefined, () => {
  for (const m of ["", "   ", null, undefined, 0, [HORS_LISTE]]) assert.equal(isModelAllowedFor(OR, m), false);
  assert.throws(() => resolveAllowedModel({ ...OR, defaultModel: null }), /Aucun modèle choisi/);
}));
