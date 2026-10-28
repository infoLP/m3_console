/* Bornes communes aux deux dialectes LLM : transport borné, attente entre deux
   tentatives, et lecture des compteurs d'usage.

   Ces fonctions sont volontairement pures et sans réseau — hormis `fetchBounded`,
   qui s'exerce avec un `fetch` de substitution. C'est ce qui permet de les tester
   sans clé d'API valide, alors que les adaptateurs eux-mêmes ne sont pas
   exerçables tant que M3-48 n'est pas réglé. */

/* --- transport borné (M3-64) ------------------------------------------------- */

/* `fetch` nu n'a aucun délai : un fournisseur qui accepte la connexion puis se
   tait bloque le run sans limite.

   Le piège, et il a été rencontré : `fetch` résout dès les EN-TÊTES. Désarmer le
   minuteur à ce moment-là — un `clearTimeout` dans un `finally` autour du seul
   `fetch` — laisse la lecture du corps sans aucune borne. Un fournisseur qui
   renvoie « 200 OK » puis n'envoie jamais le corps fige alors le run aussi
   sûrement qu'avant, et le repli mock n'a jamais l'occasion de prendre la main.
   Le corps est donc lu ICI, à l'intérieur du budget, et le minuteur ne tombe
   qu'après.

   La taille, elle, n'est pas bornée (contrairement à src/ingest/net.js) : la
   réponse est un JSON que `max_tokens` plafonne déjà côté fournisseur, et le
   délai couvre le cas d'un flux qui n'en finit pas. */
export async function fetchBounded(url, init, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      retryAfter: res.headers.get("retry-after"),
      text,
      /* Le corps est déjà lu : `json()` ne refait pas d'entrée-sortie, elle ne
         fait qu'analyser. Une réponse non-JSON (page d'erreur HTML d'un proxy,
         par exemple) donne un message qui cite le début du corps, au lieu du
         « Unexpected token < » de JSON.parse, qui ne dit pas d'où il vient. */
      json() {
        try { return JSON.parse(text); }
        catch { throw new Error(`${label} : réponse illisible (${text.slice(0, 120)})`); }
      },
    };
  } catch (err) {
    /* Sans ce message, un dépassement remonte en « This operation was aborted » :
       exact, mais rien n'y dit que c'est NOUS qui avons coupé, ni au bout de
       combien de temps. La distinction compte quand le repli mock se déclenche
       et qu'il faut savoir s'il faut relever llm_timeout_ms. */
    if (err.name === "AbortError") {
      throw new Error(`${label} : délai dépassé (${Math.round(timeoutMs / 1000)} s)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* --- attente avant la seconde tentative (M3-65) ---------------------------- */

const BASE_DELAY_MS = 1000;

/* Budget d'attente par défaut. Au-delà, on ne rejoue PAS : mieux vaut échouer et
   laisser le repli mock prendre la main que d'immobiliser un run. C'est un seuil
   d'abandon et non un écrêtage — écrêter ferait attendre 20 s un fournisseur qui
   a demandé 10 minutes, pour rejouer dans une fenêtre toujours fermée. */
export const RETRY_BUDGET_MS = 20000;

/* Délai souhaité avant de rejouer. Non plafonné : c'est à l'appelant de décider
   s'il l'accepte, en le comparant à son budget. */
export function retryDelayMs(attempt, retryAfterHeader) {
  const fromHeader = parseRetryAfter(retryAfterHeader);
  if (fromHeader != null) return fromHeader;
  return BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt));
}

/* `Retry-After` a deux formes légales, et les fournisseurs utilisent les deux :
   un nombre entier de secondes, ou une date HTTP.

   Tout le reste rend `null` — ce qui fait retomber l'appelant sur le délai
   croissant. Cette sévérité est délibérée : `Date.parse` est bien plus permissif
   qu'une date HTTP et accepte « -5 » ou « 5, 10 » (deux en-têtes fusionnés par un
   proxy) comme des dates passées, donc comme une attente de zéro. On rejouait
   alors immédiatement — exactement le défaut que M3-65 ferme, réintroduit par le
   chemin de secours. D'où l'exigence d'un jour de semaine en tête. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  }
  if (!/^[A-Za-z]{3},/.test(raw)) return null;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  /* Une date déjà passée veut dire « tu peux réessayer », pas « attends une
     durée négative ». */
  return Math.max(0, at - now);
}

export const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/* Attente avant de rejouer, partagée par les deux dialectes.

   Rend `false` quand le délai demandé dépasse le budget : on ne rejoue alors pas
   du tout, et l'erreur remonte pour que le repli mock prenne la main. Attendre
   dix minutes immobiliserait la run pour rejouer dans une fenêtre que rien ne
   garantit rouverte.

   Le budget vaut aussi comme borne de la durée totale : un appel ne peut pas
   dépasser deux fois `timeoutMs` plus ce budget. C'est pourquoi le « Tester la
   connexion » du back-office le resserre, lui qui doit répondre vite. */
export async function waitBeforeRetry(retryAfter, attempt, budgetMs, label, status) {
  const wait = retryDelayMs(attempt, retryAfter);
  if (wait > budgetMs) {
    console.warn(`[llm] ${label} HTTP ${status} : rejeu demandé dans ${Math.round(wait / 1000)} s, au-delà du budget (${Math.round(budgetMs / 1000)} s) → pas de seconde tentative`);
    return false;
  }
  await sleep(wait);
  return true;
}

/* --- relevé d'usage (M3-61) ------------------------------------------------- */

/* Les deux dialectes ne nomment pas leurs compteurs pareil, et OpenRouter ajoute
   un coût que personne d'autre ne renvoie. On normalise ici une fois pour toutes.

   Règle qui gouverne tout le module : une valeur ABSENTE ou ILLISIBLE vaut
   « inconnu », jamais « zéro ». OpenRouter renvoie par exemple `cost: ""` sur
   certains modèles gratuits ; le lire comme 0 ferait afficher « coût : 0 € » là
   où il faut lire « coût inconnu », et un futur plafond de dépense (M3-62) nourri
   de zéros ne se déclencherait jamais. */
export function readUsage(usage) {
  if (!usage || typeof usage !== "object") return emptyUsage();

  const prompt = toCount(usage.prompt_tokens ?? usage.input_tokens);
  const completion = toCount(usage.completion_tokens ?? usage.output_tokens);
  const total = toCount(usage.total_tokens);

  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    totalTokens: total ?? ((prompt ?? 0) + (completion ?? 0)),
    cost: toAmount(usage.cost),
    /* Vrai seulement si au moins un compteur était LISIBLE — la présence de la
       clé ne suffit pas. Un `prompt_tokens: "abc"` compté comme « relevé à zéro »
       ferait paraître exact un total qui est creux. */
    counted: prompt != null || completion != null || total != null,
  };
}

export function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: null, counted: false };
}

/* Accumulateur d'une run.

   `billedCalls` et non `calls` : c'est le nombre de réponses HTTP 2xx reçues du
   fournisseur, donc facturées — pas le nombre d'appels métier. Une réponse 200
   illisible est rejouée : elle compte deux fois, et à juste titre, les deux ayant
   été payées. Symétriquement, une tentative qui finit en 429 ou en 5xx n'est pas
   comptée ici. */
export function newUsageTotal() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: null, billedCalls: 0, uncounted: 0 };
}

export function addUsage(total, usage) {
  const u = usage || emptyUsage();
  total.billedCalls++;
  total.promptTokens += u.promptTokens;
  total.completionTokens += u.completionTokens;
  total.totalTokens += u.totalTokens;
  /* `cost` ne quitte `null` que si un coût a réellement été lu : additionner un
     inconnu comme un zéro ferait passer tout le total pour connu. */
  if (u.cost != null) total.cost = (total.cost || 0) + u.cost;
  if (!u.counted) total.uncounted++;
  return total;
}

/* `null` = illisible. Les deux convertisseurs refusent le négatif : un compteur
   ou un prix négatif n'a pas de sens et trahit une réponse qu'on ne comprend pas.

   Le contrôle de TYPE n'est pas de la pédanterie : `Number([])` vaut 0, et
   `Number([7])` vaut 7. Sans lui, un tableau vide passerait pour un coût de zéro
   — la confusion « inconnu / gratuit » que tout ce module s'emploie à éviter,
   réintroduite par une coercition silencieuse de JavaScript. */
const lisible = (v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "");

function toCount(v) {
  if (!lisible(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function toAmount(v) {
  if (!lisible(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
