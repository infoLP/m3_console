/* Couche LLM : choisit le moteur, appelle le bon dialecte, normalise la réponse,
   et se replie sur le mock déterministe dès qu'un appel échoue.

   Le moteur vient désormais de la BASE (onglet LLM du back-office) et non plus
   d'une variable d'environnement : en changer, ou changer de modèle, ne demande
   ni commit ni redéploiement. La clé est déchiffrée ici et ne sort pas de ce
   module — aucune des valeurs renvoyées aux appelants ne la contient.

   Le repli mock n'est jamais silencieux : `llmStats` compte les replis, le
   pipeline pousse une notification « LLM en mode dégradé » et la console affiche
   un bandeau ambre. Sans cela, l'outil produirait des articles factices sans que
   personne ne s'en aperçoive. */

import * as mock from "./mock.js";
import * as openaiCompat from "./openaiCompat.js";
import * as anthropic from "./anthropic.js";
import { activeProvider, readProviderWithKey, readCurrentPrompts } from "../lib/llmProviders.js";
import { engineIssue, fallbackIdOf, sameEngine, tryEngines, withModel, estRouteur } from "./fallback.js";
import { readSettings, SETTING_SPECS } from "../lib/yamlStore.js";
import { redact } from "../lib/redact.js";
import { newUsageTotal, addUsage } from "./limits.js";
import { capsFromSettings, anyCap, capReached, capError, periodKeys, readLedger, recordSpend } from "./budget.js";
import { resolveAllowedModel } from "./allowlist.js";
import { foldOutlineIntoBody } from "../../shared/model.js";
import { lengthTarget, fieldTargets } from "./lengthTarget.js";
import { rulesOf, checkRules, enforceRules, blocking } from "./rules.js";
import { sourceSignsOf, sourceFieldMeasuresOf } from "../generate/quality.js";
import { resolvePrompt } from "./prompts/template.js";

const ADAPTERS = { openai: openaiCompat, anthropic };

export function adapterFor(kind) {
  const a = ADAPTERS[kind];
  if (!a) throw Object.assign(new Error(`protocole inconnu : ${kind}`), { status: 400 });
  return a;
}

/* Dernier moteur résolu. Existe pour que `providerName()` reste synchrone : il
   est lu par `meta.me()`, le pipeline et la console, à des endroits où rendre la
   fonction asynchrone propagerait des `await` sans rien apporter. */
let current = null;
let resolved = false;   // le moteur a-t-il été lu au moins une fois ?

/* Bornes de l'appel (M3-60, M3-64), relues en même temps que le moteur. Les
   garder ici plutôt que de les passer depuis chaque appelant évite de les
   oublier sur l'un d'eux : la régénération d'un article (src/api/articles.js)
   ne lit pas les réglages, elle aurait appelé sans plafond ni délai.

   Le repli sur les défauts du registre n'est pas cosmétique : si la base est
   injoignable, `refreshProvider` bascule en mock — mais un appel direct à
   l'adaptateur partirait sinon avec des bornes indéfinies. */
let limits = {
  maxTokens: SETTING_SPECS.llm_max_tokens.default,
  timeoutMs: SETTING_SPECS.llm_timeout_ms.default,
};

/* Plafonds de dépense (M3-62), relus avec les bornes. Défaut : aucun. */
let caps = capsFromSettings({});

/* Repli de transition : avant l'onglet LLM, la clé OpenRouter venait de
   l'environnement. On l'accepte encore pour le moteur `openrouter` tant qu'aucune
   clé n'a été posée au back-office, pour qu'une mise à jour ne coupe pas une
   installation qui marchait. À retirer quand toutes les clés seront en base. */
export function withEnvFallback(p) {
  if (!p) return p;
  if (!p.apiKey && p.id === "openrouter" && process.env.OPENROUTER_API_KEY) {
    return { ...p, apiKey: process.env.OPENROUTER_API_KEY, keySource: "env" };
  }
  return p;
}

/* Moteur de secours (M3-88), relu avec le moteur actif. Null si aucun n'est
   réglé, s'il est le moteur actif avec le même modèle, ou s'il n'est pas utilisable —
   le motif est gardé dans `secoursIssue` pour le dire. */
let secours = null;
let secoursIssue = null;

/* Relit le moteur actif. Appelée avant chaque run de génération : une modification
   faite au back-office pendant que le serveur tourne prend effet immédiatement. */
export async function refreshProvider() {
  try {
    const p = withEnvFallback(await activeProvider());
    /* Un moteur sans clé ou sans modèle n'est pas utilisable : autant le traiter
       comme absent et basculer en mock tout de suite, plutôt que d'échouer au
       premier appel et de compter un repli par article. */
    current = p && p.apiKey && (p.defaultModel || "").trim() ? p : null;
  } catch {
    /* Base injoignable : le mock permet au moins de ne pas interrompre un run. */
    current = null;
  }
  let s = null;
  try {
    s = await readSettings();
    limits = { maxTokens: s.llm_max_tokens, timeoutMs: s.llm_timeout_ms };
    caps = capsFromSettings(s);
  } catch {
    /* Réglages illisibles : on garde les bornes précédentes. Ne PAS repartir
       sans borne — c'est exactement la situation que M3-60 et M3-64 corrigent. */
  }
  engineCache.clear();
  await refreshSecours(s);
  await refreshReview(s);
  await refreshPrompts();
  resolved = true;
  return providerName();
}

/* Relecture automatique (M3-89) : activée ou non, et par quel moteur. « mock »
   est admis — relecture mécanique, sans coût — pour essayer la chaîne. Le moteur
   de relecture peut être le moteur actif lui-même : c'est un choix de
   l'administrateur, pas une erreur. */
const MOCK_REVIEWER = { id: "mock", label: "LLM mock", defaultModel: null };
let reviewEnabled = false;
let reviewer = null;
let reviewIssue = null;

async function refreshReview(s) {
  if (!s) return;
  reviewEnabled = s.llm_review_enabled === "oui";
  reviewer = null;
  reviewIssue = null;
  if (!reviewEnabled) return;
  const id = fallbackIdOf(s.llm_review_provider);
  if (!id) { reviewIssue = "aucun moteur de relecture réglé"; return; }
  if (id === "mock") { reviewer = MOCK_REVIEWER; return; }
  try {
    const p = withModel(withEnvFallback(await readProviderWithKey(id)), s.llm_review_model);
    reviewIssue = engineIssue(p);
    if (!reviewIssue) reviewer = p;
  } catch (err) {
    reviewIssue = `registre illisible (${err.message})`;
  }
  if (reviewIssue) console.warn(`[llm] relecture automatique « ${id} » indisponible : ${reviewIssue}`);
}

/* Secours relu à chaque run, comme le moteur actif. Réglages illisibles : on
   garde le précédent, comme les bornes. */
async function refreshSecours(s) {
  if (!s) return;
  const id = fallbackIdOf(s.llm_fallback_provider);
  secours = null;
  secoursIssue = null;
  if (!id || !current) return;
  try {
    /* Moteur + modèle : le secours peut être le moteur actif lui-même, appelé
       avec un autre modèle (OpenRouter mistral en principal, openai en secours,
       une seule clé). Même moteur et même modèle : pas de secours, sans bruit. */
    const p = withModel(withEnvFallback(await readProviderWithKey(id)), s.llm_fallback_model);
    if (sameEngine(p, current)) return;
    secoursIssue = engineIssue(p);
    if (!secoursIssue) secours = p;
  } catch (err) {
    secoursIssue = `registre illisible (${err.message})`;
  }
  if (secoursIssue) console.warn(`[llm] moteur de secours « ${id} » écarté : ${secoursIssue}`);
}

/* Prompts de génération du back-office (M3-56) : version courante de chaque
   (moteur, modèle), lue une fois par run avec le moteur actif. Base illisible —
   ou table pas encore migrée — : aucun, donc le prompt général du code. La
   génération ne doit jamais échouer pour un prompt. */
let promptRows = [];
const promptWarned = new Set();

async function refreshPrompts() {
  promptWarned.clear();
  try {
    promptRows = await readCurrentPrompts();
  } catch (err) {
    promptRows = [];
    console.warn(`[llm] prompts de génération illisibles (${err.message}) → prompt par défaut du code`);
  }
}

/* Modèle de prompt pour CET appel : le moteur qui le sert (principal ou
   secours) et le modèle réellement envoyé. Un modèle en base devenu invalide est
   écarté, signalé une fois par run, et le niveau supérieur s'applique. */
function promptFor(engine, model) {
  const r = resolvePrompt(promptRows, engine.id, model || engine.defaultModel);
  for (const i of r.ignored) {
    const k = `${i.scope}:${i.id}`;
    if (promptWarned.has(k)) continue;
    promptWarned.add(k);
    console.warn(`[llm] prompt de génération n° ${i.id} (${i.scope}) ignoré, invalide : ${i.errors.join(" ; ")} → niveau supérieur`);
  }
  return r;
}

/* Le prompt qui a servi : posé sur l'article généré (`gen.prompt`) et compté
   dans les stats de la run (`llmStats.prompts`). `scope` : « modele »,
   « moteur », « general » (base) ou « defaut » (code) ; `id`/`version` : la
   ligne de llm_prompts, null pour le défaut du code. */
const promptInfo = (r, engine, model) => ({
  scope: r.scope, id: r.id, version: r.version,
  provider: engine.id, model: model || engine.defaultModel || null,
});

function notePrompt(info) {
  const same = llmStats.prompts.find((p) => p.id === info.id && p.scope === info.scope && p.provider === info.provider && p.model === info.model);
  if (same) same.articles++;
  else llmStats.prompts.push({ ...info, articles: 1 });
}

/* Moteur imposé PAR APPEL (M3-55, relances sur hallucination) : « moteur »,
   « moteur:modèle » ou { id, model }. Le modèle peut lui-même contenir « : »
   (`meta/llama:free`) : seul le premier sépare. */
export function engineSpecOf(spec) {
  if (spec && typeof spec === "object") {
    const id = String(spec.id ?? "").trim();
    const model = String(spec.model ?? "").trim();
    return { id: id || null, model: model || null };
  }
  const t = String(spec ?? "").trim();
  const i = t.indexOf(":");
  const id = (i < 0 ? t : t.slice(0, i)).trim();
  const model = i < 0 ? "" : t.slice(i + 1).trim();
  return { id: id || null, model: model || null };
}

/* Registre lu une fois par moteur et par run (vidé par refreshProvider) : une
   liste de relance de trois moteurs ne relit pas la base à chaque article. */
const engineCache = new Map();
let testRegistry = null;

async function lookupProvider(id) {
  if (testRegistry) return testRegistry[id] ?? null;
  if (!engineCache.has(id)) {
    const p = readProviderWithKey(id).then(withEnvFallback);
    engineCache.set(id, p);
    p.catch(() => engineCache.delete(id));
  }
  return engineCache.get(id);
}

/* Moteur imposé → le moteur avec sa clé (reste dans ce module), ou le motif qui
   l'écarte : mêmes critères que le secours (engineIssue), plus deux propres aux
   relances — pas le mock (il passerait pour une réécriture), pas un routeur ou
   un alias (le modèle réellement appelé varie, le prompt par modèle de M3-56 ne
   peut pas s'y appliquer). */
async function resolveEngine(spec) {
  const { id, model } = engineSpecOf(spec);
  const base = { id, model, label: id };
  if (!id) return { ...base, engine: null, issue: "moteur non précisé" };
  if (id === "mock") return { ...base, engine: null, issue: "le mock n'est pas un moteur de génération réel" };
  if (model && estRouteur(model)) return { ...base, engine: null, issue: ROUTEUR };
  let p;
  try { p = withModel(await lookupProvider(id), model); }
  catch (err) { return { ...base, engine: null, issue: `registre illisible (${err.message})` }; }
  const out = { id, model: p?.defaultModel || model || null, label: p?.label || id };
  let issue = engineIssue(p);
  if (!issue && estRouteur(out.model)) issue = ROUTEUR;
  return { ...out, engine: issue ? null : p, issue };
}
const ROUTEUR = "modèle variable (routeur) : exclu des relances";

/* Même chose, sans la clé : ce que les appelants (src/generate/relance.js) ont
   besoin de savoir pour sauter un moteur avec son motif. */
export async function describeEngine(spec) {
  const { engine: _e, ...rest } = await resolveEngine(spec);
  return rest;
}

/* Moteur de secours retenu pour cette run, ou null — et pourquoi il manque. */
export function secoursInfo() {
  return secours ? { id: secours.id, label: secours.label, model: secours.defaultModel } : null;
}
export function secoursProblem() {
  return secoursIssue;
}

/* Lu par le pipeline pour tracer les bornes effectives d'une run : une sortie
   tronquée ou un appel coupé s'expliquent par ces deux valeurs, et elles se
   changent au back-office entre deux runs. */
export function llmLimits() {
  return { ...limits };
}

export function providerName() {
  return current ? current.id : "mock";
}
export function providerLabel() {
  return current ? current.label : "LLM mock";
}
export function providerModel() {
  return current ? current.defaultModel : null;
}

/* `usage` : la passerelle renvoie les tokens consommés à chaque appel, et on les
   jetait. Sans eux, rien ne permet de dire ce qu'a coûté une run — et donc rien
   ne permet de poser un plafond de dépense (M3-62). */
/* `capHit` : premier plafond atteint pendant la run (M3-62), ou null.
   `capped` : appels repliés sur le mock À CAUSE du plafond. Ils comptent aussi
   dans `fallbacks`, parce que l'article qui en sort est bien un article mock et
   doit être marqué comme tel ; `capped` permet de ne pas les annoncer comme une
   panne du fournisseur. */
/* `ruleRetries` : nouvelles demandes faites parce qu'une règle des Paramètres
   n'était pas tenue (M3-87) ; `ruleMisses` : articles rendus malgré tout avec un
   écart, relances épuisées. */
/* `switch` : bascule sur le moteur de secours (M3-88) — de qui, vers qui,
   pourquoi, quand ; null tant que le principal tient. `secoursCalls` : appels
   servis par le secours. Les deux partent dans les `stats` de la run : la
   bascule n'est jamais silencieuse. */
export const llmStats = {
  configured: "mock", calls: 0, fallbacks: 0, lastError: null, usage: newUsageTotal(),
  capHit: null, capped: 0, ruleRetries: 0, ruleMisses: 0,
  switch: null, secoursCalls: 0,
  reviews: newReviewStats(),
  prompts: [],
  regen: newRegenStats(),
};

/* Relances sur hallucination de la run (M3-55), tenues par src/generate/relance.js :
   articles relancés, relances faites et réussies, hallucinations persistantes,
   moteurs sautés, arrêts (plafond), et le diagnostic de chaque relance — la
   matière pour affiner le prompt de génération, comme les suggestions de la
   relecture. */
export function newRegenStats() {
  return { articles: 0, relances: 0, reussies: 0, persistantes: 0, sautes: 0, arrets: 0, suggestions: [], diagnostics: [] };
}

/* Relectures de la run (M3-89) : verdicts comptés, et les suggestions de
   consigne relevées — la matière pour affiner le prompt de génération. */
function newReviewStats() {
  return { done: 0, ok: 0, a_corriger: 0, rejet: 0, failed: 0, skipped: 0, suggestions: [] };
}

function clearStats() {
  llmStats.configured = providerName();
  llmStats.calls = 0;
  llmStats.fallbacks = 0;
  llmStats.lastError = null;
  llmStats.usage = newUsageTotal();
  llmStats.capHit = null;
  llmStats.capped = 0;
  llmStats.ruleRetries = 0;
  llmStats.ruleMisses = 0;
  llmStats.switch = null;
  llmStats.secoursCalls = 0;
  llmStats.reviews = newReviewStats();
  llmStats.prompts = [];
  llmStats.regen = newRegenStats();
}

export async function resetLlmStats() {
  await refreshProvider();
  clearStats();
}

/* Plafond atteint avant cet appel ? Le registre jour/mois n'est lu que si un
   plafond de période est posé.

   Registre illisible : on laisse passer, en le disant. Bloquer serait plus
   prudent sur le papier, mais une base qui ne répond plus fait de toute façon
   échouer l'écriture de l'article juste après ; et le plafond par run, lui,
   reste appliqué puisqu'il est tenu en mémoire. */
async function budgetCheck() {
  if (!anyCap(caps)) return null;
  let ledger = null;
  const periodCap = [caps.day, caps.month].some((c) => c.usd > 0 || c.tokens > 0);
  if (periodCap) {
    try { ledger = await readLedger(); }
    catch (err) { console.warn(`[llm] registre de dépense illisible (${err.message}) → plafonds jour/mois non vérifiés pour cet appel`); }
  }
  const { day, month } = periodKeys();
  return capReached({ run: llmStats.usage, day: ledger?.days?.[day], month: ledger?.months?.[month] }, caps);
}

/* Chaque appel facturé est reporté au registre jour/mois, plafonds posés ou
   non : on peut alors en poser un en cours de mois, il part du vrai cumul.
   Un échec d'écriture ne doit pas faire perdre une réponse déjà payée. */
async function persistSpend(usages) {
  for (const u of usages) {
    try { await recordSpend(u); }
    catch (err) { console.warn(`[llm] dépense non reportée au registre (${err.message})`); }
  }
}

/* La liste blanche (M3-63) se vérifie ICI, au dernier point avant le réseau,
   et non dans `refreshProvider`. Deux raisons :
   - c'est le seul endroit qui voit le modèle réellement envoyé, `opts.model`
     compris — le modèle par défaut du moteur n'est qu'un cas parmi d'autres ;
   - un refus lève une erreur, que `withFallback` traite comme un échec d'appel :
     repli COMPTÉ (moteur de secours, puis mock), `lastError` renseigné,
     notification. Écarter le moteur dans `refreshProvider`, comme on le fait
     d'un moteur sans clé, rendrait le repli silencieux — or un modèle refusé
     est une erreur de configuration à corriger, pas une absence voulue.

   `engine` : le moteur qui sert CET appel — principal, secours (M3-88) ou
   relecture (M3-89). Chacun passe par la liste blanche, les bornes et le
   relevé de dépense : aucun chemin ne contourne M3-60 à M3-63. */
async function callProvider(engine, system, user, opts) {
  const model = resolveAllowedModel(engine, opts.model);
  const spent = [];
  try {
    return await adapterFor(engine.kind).chat(engine, system, user, {
      ...opts,
      model,
      maxTokens: limits.maxTokens,
      timeoutMs: limits.timeoutMs,
      onUsage: (u) => { addUsage(llmStats.usage, u); spent.push(u); },
    });
  } finally {
    /* `finally` : une réponse facturée puis illisible a été payée quand même. */
    await persistSpend(spent);
  }
}

/* Plafond atteint (M3-62) : arrêt, ou repli mock compté comme tel. */
function onCap(hit, mockFn, args) {
  if (!llmStats.capHit) {
    llmStats.capHit = hit;
    console.warn(`[llm] ${hit.detail} → ${caps.action === "stop" ? "génération interrompue" : "repli mock"}`);
  }
  if (caps.action === "stop") throw capError(hit);
  llmStats.capped++;
  llmStats.fallbacks++;
  return mockFn(...args);
}

/* Moteurs à essayer pour un appel, dans l'ordre (M3-88). Une fois le principal
   tombé, la run reste sur le secours : sinon chaque appel suivant paierait
   d'abord le délai et les relances d'un moteur qu'on sait en panne. La run
   suivante (resetLlmStats) redonne sa chance au principal. */
function enginesForCall() {
  if (!current) return [];
  if (llmStats.switch && secours) return [secours];
  return secours ? [current, secours] : [current];
}

async function withFallback(fn, mockFn, args) {
  llmStats.calls++;
  /* Première utilisation dans ce processus : le moteur n'a pas encore été lu. */
  if (!resolved) await refreshProvider();
  const engines = enginesForCall();
  if (!engines.length) return mockFn(...args);
  const hit = await budgetCheck();
  if (hit) return onCap(hit, mockFn, args);
  try {
    const r = await tryEngines(engines, fn, {
      /* Le secours se paie aussi : plafond revérifié avant de le solliciter. */
      beforeNext: async () => {
        const h = await budgetCheck();
        if (h) throw Object.assign(new Error(h.detail), { code: "LLM_CAP_BEFORE_SECOURS", hit: h });
      },
      onFail: (engine, err, next) => {
        /* Le message d'erreur embarque la réponse du fournisseur, qui renvoie
           parfois en écho l'en-tête d'authentification reçu. Il finit dans une
           notification, dans le document de l'article et dans le journal du
           conteneur : c'est le second point de passage à garder. */
        const msg = redact(err.message || String(err));
        llmStats.lastError = msg;
        if (next && !llmStats.switch) {
          llmStats.switch = {
            from: { id: engine.id, label: engine.label, model: engine.defaultModel },
            to: { id: next.id, label: next.label, model: next.defaultModel },
            error: msg, at: new Date().toISOString(),
          };
        }
        /* Le modèle est nommé : principal et secours peuvent être le même moteur. */
        console.warn(`[llm] échec ${engine.label} · ${engine.defaultModel} (${msg}) → ${next ? `moteur de secours ${next.label} · ${next.defaultModel}` : "repli mock"}`);
      },
    });
    if (r.engine !== current) llmStats.secoursCalls++;
    return r.value;
  } catch (err) {
    if (err.code === "LLM_CAP_BEFORE_SECOURS") return onCap(err.hit, mockFn, args);
    llmStats.fallbacks++;
    return mockFn(...args);
  }
}

/* Appel sur un moteur IMPOSÉ (M3-55) : ni secours ni repli mock — une relance
   servie par le mock remplacerait un vrai texte par un texte factice. Plafond
   (M3-62) vérifié avant, quelle que soit son action : atteint, l'appel lève
   LLM_CAP et l'appelant arrête ses relances. Un échec remonte (message
   expurgé). Liste blanche, bornes et relevé de dépense : callProvider, comme
   tout appel. */
async function withEngine(engine, fn) {
  llmStats.calls++;
  const hit = await budgetCheck();
  if (hit) {
    if (!llmStats.capHit) {
      llmStats.capHit = hit;
      console.warn(`[llm] ${hit.detail} → relance sur ${engine.label} non faite`);
    }
    throw capError(hit);
  }
  try {
    return await fn(engine);
  } catch (err) {
    const msg = redact(err.message || String(err));
    console.warn(`[llm] échec ${engine.label} · ${engine.defaultModel} (${msg}) → moteur imposé, ni secours ni repli mock`);
    throw Object.assign(new Error(msg), { code: err.code || "LLM_ENGINE_FAILED", status: err.status });
  }
}

/* ------------------------------------------------- les trois appels métier */

/* La normalisation vit ici et non dans les adaptateurs : elle ne dépend pas du
   dialecte, et la dupliquer par fournisseur, c'est se garantir qu'un champ
   ajouté sera oublié dans l'un des deux. */

export async function extractFromSource(rawText, opts = {}) {
  const P = await import("./prompts/extract.js");
  const extracted = await withFallback(async (engine) => {
    const j = await callProvider(engine, P.SYSTEM, P.userPrompt(rawText, opts), { model: opts.model });
    return {
      title_hint: j.title_hint || "",
      facts: Array.isArray(j.facts) ? j.facts : [],
      quotes: Array.isArray(j.quotes) ? j.quotes : [],
      entities: Array.isArray(j.entities) ? j.entities : [],
      locality: j.locality || "inconnu",
      angle: j.angle || "",
      suggested_category: j.suggested_category || "Société",
    };
  }, mock.extractFromSource, [rawText, opts]);
  /* Mesure de la source (M3-86), gardée avec l'extraction : la régénération
     d'un article ne relit que `origin.extracted`, et doit viser la même
     longueur que la génération. */
  /* Titre et chapô de la source (M3-86, titres et méta) : mesurés ici pour la
     même raison. Sans titre transmis (`opts.sourceTitle`), les cibles du titre et
     de la balise titre restent nulles : règle d'avant. */
  return { ...extracted, source_signs: sourceSignsOf(rawText), ...sourceFieldMeasuresOf({ title: opts.sourceTitle, text: rawText }) };
}

/* Réponse brute du modèle → article normalisé. Un modèle qui répond encore à
   l'ancienne forme — corps plat + plan séparé — n'est pas rejeté : son plan est
   replié dans le corps plutôt que perdu. C'est la même opération que la
   migration du stock (007). */
function normalizeGenerated(j, extracted) {
  const body = foldOutlineIntoBody(
    Array.isArray(j.body) ? j.body : [String(j.body || "")],
    j.seo?.outline
  );
  return {
    title: j.title || extracted.title_hint || "Article",
    chapo: j.chapo || "",
    body,
    category: j.category || extracted.suggested_category || "Société",
    suggested_ranking: Number(j.suggested_ranking) || 65,
    ranking_reason: j.ranking_reason || "",
    seo: {
      metaTitle: j.seo?.metaTitle || "",
      metaDescription: j.seo?.metaDescription || "",
      slug: j.seo?.slug || "",
      keywords: Array.isArray(j.seo?.keywords) ? j.seo.keywords : [],
    },
  };
}

/* `opts.engine` (M3-55) : moteur imposé pour CET appel — « moteur »,
   « moteur:modèle » ou { id, model } —, qui court-circuite le moteur actif et le
   secours ; même chaîne pour le reste (liste blanche, plafond, dépense, règles,
   prompt propre à ce moteur). Inutilisable : lève LLM_ENGINE_UNUSABLE avec le
   motif. `opts.recadrage` : consigne ajoutée APRÈS le prompt rendu (verdict de
   la relecture précédente), comme la correction des règles. */
export async function generateArticle(extracted, opts = {}) {
  const P = await import("./prompts/generate.js");
  let forced = null;
  if (opts.engine) {
    if (!resolved) await refreshProvider();
    const r = await resolveEngine(opts.engine);
    if (r.issue) throw Object.assign(new Error(`moteur « ${r.id || "?"} » inutilisable : ${r.issue}`), { code: "LLM_ENGINE_UNUSABLE", issue: r.issue });
    forced = r.engine;
  }
  /* Moteur imposé : son modèle est dans `defaultModel` (withModel), il prime. */
  const callModel = forced ? undefined : opts.model;
  const recadrage = opts.recadrage ? String(opts.recadrage) : "";
  const rules = rulesOf(opts.rules);
  /* La cible de longueur (M3-86) est calculée une fois, par la fonction que le
     prompt appelle aussi, puis rendue avec l'article : le contrôle qui suit la
     relit telle quelle au lieu de la recalculer. */
  const target = lengthTarget(rules, opts.sourceSigns ?? extracted?.source_signs);
  /* Même principe pour le titre, la balise titre et la méta-description (M3-86) :
     mêmes mesures que celles que lit le prompt (variablesDe), même fonction. */
  const fields = fieldTargets(rules, {
    sourceTitleChars: opts.sourceTitleChars ?? extracted?.source_title_chars,
    sourceLeadChars: opts.sourceLeadChars ?? extracted?.source_lead_chars,
  });
  const produce = async (engine) => {
    /* Les règles des Paramètres sont TENUES, pas seulement citées (M3-87) :
       réponse contrôlée, et redemandée avec la liste des écarts tant qu'il en
       reste et que rules_retry_max et le plafond de dépense le permettent. */
    /* Prompt construit PAR MOTEUR (M3-56) : le secours peut avoir sa propre
       surcharge — ou être le même moteur appelé avec un autre modèle. */
    const tpl = promptFor(engine, callModel);
    const prompt = P.userPrompt(extracted, { ...opts, template: tpl.template }) + recadrage;
    const r = await enforceRules({
      produce: async (feedback) => normalizeGenerated(
        await callProvider(engine, P.SYSTEM, feedback ? prompt + feedback : prompt, { model: callModel, temperature: 0.6 }),
        extracted
      ),
      check: (g) => checkRules(g, rules, target, fields),
      maxRetries: Math.max(0, Number(rules.rules_retry_max) || 0),
      canRetry: async () => !(await budgetCheck()),
    });
    llmStats.ruleRetries += r.attempts - 1;
    if (blocking(r.violations).length) llmStats.ruleMisses++;
    const info = promptInfo(tpl, engine, callModel);
    notePrompt(info);
    return { ...r.gen, ruleCheck: { attempts: r.attempts, violations: r.violations, stopped: r.stopped }, prompt: info };
  };
  const gen = forced ? await withEngine(forced, produce) : await withFallback(produce, mock.generateArticle, [extracted, opts]);
  /* Mock (repli ou absence de moteur) : aucun prompt n'a servi. */
  return { ...gen, prompt: gen.prompt || null, lengthTarget: target, fieldTargets: fields };
}

export async function checkPlagiarism(sourceText, generatedText, opts = {}) {
  const P = await import("./prompts/plagiarism.js");
  return withFallback(async (engine) => {
    const j = await callProvider(engine, P.SYSTEM, P.userPrompt(sourceText, generatedText), { model: opts.model, temperature: 0 });
    return {
      score: Math.max(0, Math.min(1, Number(j.score) || 0)),
      verdict: j.verdict === "risque" ? "risque" : "ok",
      spans: Array.isArray(j.spans) ? j.spans : [],
    };
  }, mock.checkPlagiarism, [sourceText, generatedText, opts]);
}

/* Relecture automatique d'un article généré (M3-89) : le moteur de relecture
   compare l'article à sa source et rend un verdict motivé, stocké tel quel.

   → null si la relecture est désactivée ; sinon un objet toujours daté et
   attribué, dont `status` dit ce qui s'est passé : « fait » (verdict rendu),
   « indisponible » (aucun moteur utilisable), « plafond » (M3-62 : la relecture
   se paie comme une génération, elle s'arrête au même plafond), « echec ».

   Pas de repli mock ni de secours ici : un verdict de remplacement passerait
   pour un jugement qu'aucun modèle n'a porté. Ne lève jamais — une relecture
   manquée ne doit pas coûter l'article. */
export async function reviewArticle(sourceText, article) {
  if (!resolved) await refreshProvider();
  if (!reviewEnabled) return null;
  const at = new Date().toISOString();
  const by = reviewer ? { engine: reviewer.id, model: reviewer.defaultModel || null } : { engine: null, model: null };
  const R = llmStats.reviews;
  if (!reviewer) {
    R.skipped++;
    return { status: "indisponible", detail: reviewIssue || "aucun moteur de relecture", at, ...by };
  }
  let verdict;
  if (reviewer === MOCK_REVIEWER) {
    verdict = await mock.reviewArticle(sourceText, article);
  } else {
    const hit = await budgetCheck();
    if (hit) {
      R.skipped++;
      return { status: "plafond", detail: hit.detail, at, ...by };
    }
    try {
      const P = await import("./prompts/review.js");
      llmStats.calls++;
      const j = await callProvider(reviewer, P.SYSTEM, P.userPrompt(sourceText, article), { temperature: 0 });
      verdict = P.normalizeReview(j);
    } catch (err) {
      R.failed++;
      const detail = redact(err.message || String(err));
      console.warn(`[llm] relecture ${reviewer.label} en échec (${detail})`);
      return { status: "echec", detail, at, ...by };
    }
  }
  R.done++;
  R[verdict.verdict] = (R[verdict.verdict] || 0) + 1;
  if (verdict.suggestionPrompt && R.suggestions.length < 5 && !R.suggestions.includes(verdict.suggestionPrompt)) {
    R.suggestions.push(verdict.suggestionPrompt);
  }
  /* Le diagnostic part aussi au journal du conteneur : c'est la matière pour
     affiner l'agent de génération, lisible sans ouvrir chaque article. */
  if (verdict.verdict !== "ok") {
    console.warn(`[llm] relecture ${reviewer.label} : ${verdict.verdict} — ${verdict.resume}${verdict.suggestionPrompt ? ` · suggestion : ${verdict.suggestionPrompt}` : ""}`);
  }
  return { status: "fait", ...verdict, at, ...by };
}

/* Pour les tests seulement : poser des moteurs et des adaptateurs simulés, sans
   base ni réseau (test/llmFallback.test.js). Rien en production ne l'appelle. */
export const __test = {
  /* `prompts` : versions courantes de llm_prompts simulées (M3-56), même forme
     que readCurrentPrompts() — { id, providerId, model, template, version }. */
  /* `registry` : moteurs du registre simulés par identifiant (relances, M3-55). */
  useEngines({ primary = null, fallback = null, review = null, adapters = {}, settings = {}, prompts = [], registry = null } = {}) {
    promptRows = prompts;
    testRegistry = registry || {};
    engineCache.clear();
    promptWarned.clear();
    current = primary;
    secours = fallback;
    secoursIssue = null;
    resolved = true;
    Object.assign(ADAPTERS, adapters);
    caps = capsFromSettings(settings);
    reviewEnabled = !!review;
    reviewer = review === "mock" ? MOCK_REVIEWER : review || null;
    reviewIssue = null;
    clearStats();
  },
};
