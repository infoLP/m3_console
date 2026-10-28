/* Dialecte OpenAI — `POST {baseUrl}/chat/completions`.

   Parlé par OpenRouter, OpenAI, Google (endpoint de compatibilité), Mistral,
   Ollama et LM Studio : un seul module couvre tout ce qui n'est pas Anthropic.
   Le moteur (URL, clé, modèle) vient de la base, plus de l'environnement.

   Les bornes de l'appel — plafond de sortie, délai, attente entre deux
   tentatives — viennent de l'appelant (réglages llm_max_tokens et
   llm_timeout_ms, cf. src/llm/index.js). Les valeurs par défaut ci-dessous ne
   servent qu'aux appels directs, comme le « Tester la connexion » du
   back-office : rien ici n'est un réglage caché. */

import { parseJsonLoose } from "./jsonLoose.js";
import { fetchBounded, waitBeforeRetry, readUsage, RETRY_BUDGET_MS } from "./limits.js";

/* Exporté pour l'API batch (src/llm/batch.js) : mêmes en-têtes d'attribution. */
export const ATTRIBUTION = {
  "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://github.com/infoLP/M3",
  "X-Title": process.env.OPENROUTER_APP_NAME || "M3",
};

/* `usage: { include: true }` est une extension OpenRouter, pas du dialecte
   OpenAI : elle fait renvoyer le coût réel de l'appel en plus des tokens.
   Elle n'est donc envoyée qu'à OpenRouter — l'API OpenAI refuse en 400 un
   paramètre qu'elle ne connaît pas, et ce module sert aussi OpenAI, Mistral
   et Ollama. */
const isOpenRouter = (provider) =>
  provider.id === "openrouter" || /(^|\.)openrouter\.ai$/i.test(hostOf(provider.baseUrl));

export async function chat(provider, system, user, {
  model,
  temperature = 0.4,
  maxTokens = 4096,
  timeoutMs = 120000,
  retryBudgetMs = RETRY_BUDGET_MS,
  onUsage = null,
} = {}) {
  const mdl = model || provider.defaultModel;
  if (!mdl) throw new Error(`Aucun modèle choisi pour « ${provider.label} ».`);

  const body = {
    model: mdl,
    temperature,
    /* Sans plafond, une sortie qui part en boucle se paie au token et n'est
       bornée que par la limite du modèle — souvent bien au-delà d'un article. */
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (isOpenRouter(provider)) body.usage = { include: true };

  for (let attempt = 0; attempt < 2; attempt++) {
    /* Un budget par tentative, et non pour leur somme : partagé, il ferait
       avorter la seconde tentative d'entrée de jeu si la première avait consommé
       le sien. */
    const res = await fetchBounded(`${trim(provider.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        ...ATTRIBUTION,
      },
      body: JSON.stringify(body),
    }, timeoutMs, provider.label);

    if (!res.ok) {
      /* 429 compris : derrière une passerelle les quotas sont mutualisés, la
         limite se rencontre bien plus souvent qu'en direct. */
      if (attempt === 0 && (res.status >= 500 || res.status === 429)) {
        const waited = await waitBeforeRetry(res.retryAfter, attempt, retryBudgetMs, provider.label, res.status);
        if (waited) continue;
      }
      throw new Error(`${provider.label} HTTP ${res.status} ${res.text.slice(0, 200)}`);
    }
    const data = res.json();
    /* Une passerelle peut répondre 200 en portant l'erreur du fournisseur en
       aval dans le corps. Sans ce contrôle on échoue plus loin, sur un `choices`
       absent, avec un message qui ne dit rien de la cause. */
    if (data.error) {
      if (attempt === 0 && await waitBeforeRetry(null, attempt, retryBudgetMs, provider.label, 200)) continue;
      throw new Error(`${provider.label} : ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
    }
    /* L'usage est relevé même quand le parse échouera juste après : les tokens
       ont été facturés, les compter est le seul moyen de savoir ce qu'a coûté
       une run ratée. */
    if (onUsage) onUsage(readUsage(data.usage));

    const parsed = parseJsonLoose(data.choices?.[0]?.message?.content || "");
    if (parsed) return parsed;
    /* Pas d'attente ici : une réponse illisible ne vient pas d'une fenêtre de
       quota, attendre ne changerait rien à la seconde tentative. */
    if (attempt === 0) continue;
    throw new Error(`Réponse non parsable en JSON (${provider.label}, modèle ${mdl})`);
  }
  throw new Error(`${provider.label} : échec après 2 tentatives`);
}

/* Le modèle répond-il ? Appel d'un token, sans `response_format` ni parse : on
   ne juge que le statut (test du catalogue, src/llm/modelTests.js). Pas de
   rejeu non plus — un 429 EST le verdict qu'on cherche. Ne lève que sur une
   erreur réseau ou un délai dépassé ; une erreur HTTP est rendue, pas levée.

   Les modèles « à raisonnement » d'OpenAI refusent `max_tokens` (400) et
   exigent `max_completion_tokens` : sans le second essai, ils passeraient tous
   pour cassés alors que la génération, qui passe par OpenRouter, les sert. */
export async function ping(provider, model, { timeoutMs = 30000 } = {}) {
  const base = { model, messages: [{ role: "user", content: "ok" }] };
  if (isOpenRouter(provider)) base.usage = { include: true };
  let r = await pingOnce(provider, { ...base, max_tokens: 1 }, timeoutMs);
  if (!r.ok && r.status === 400 && /max_tokens|max_completion_tokens/i.test(r.message)) {
    r = await pingOnce(provider, { ...base, max_completion_tokens: 16 }, timeoutMs);
  }
  return r;
}

async function pingOnce(provider, body, timeoutMs) {
  const res = await fetchBounded(`${trim(provider.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}`, ...ATTRIBUTION },
    body: JSON.stringify(body),
  }, timeoutMs, provider.label);
  if (!res.ok) return { ok: false, status: res.status, message: res.text.slice(0, 300) };
  let data;
  try { data = res.json(); } catch (err) { return { ok: false, status: res.status, message: err.message }; }
  const usage = readUsage(data.usage);
  /* 200 portant l'erreur du fournisseur en aval : même piège que dans chat(). */
  if (data.error) {
    return { ok: false, status: Number(data.error.code) || res.status, message: String(data.error.message || JSON.stringify(data.error)).slice(0, 300), usage };
  }
  return { ok: true, status: res.status, usage };
}

/* `GET {baseUrl}/models` — même forme `{ data: [{ id }] }` chez tous.
   OpenRouter répond sans authentification, les autres l'exigent. */
export async function listModels(provider, { timeoutMs = 30000 } = {}) {
  const headers = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {};
  const res = await fetchBounded(`${trim(provider.baseUrl)}/models`, { headers }, timeoutMs, provider.label);
  if (!res.ok) throw new Error(`${provider.label} HTTP ${res.status} ${res.text.slice(0, 200)}`);
  const data = res.json();
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return list.map((m) => m.id || m.name).filter(Boolean);
}

const trim = (u) => String(u || "").replace(/\/+$/, "");

function hostOf(u) {
  try { return new URL(String(u)).hostname; } catch { return ""; }
}
