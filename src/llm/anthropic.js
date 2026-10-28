/* Dialecte Anthropic — `POST {baseUrl}/messages`.

   Trois différences avec le dialecte OpenAI, et chacune casse l'appel si on
   l'oublie :
   - l'authentification est `x-api-key`, pas `Authorization: Bearer` ;
   - l'en-tête de version `anthropic-version` est OBLIGATOIRE ;
   - `max_tokens` est obligatoire, et le message système est un champ à part,
     pas un tour de conversation.

   Il n'y a pas de `response_format` : le JSON s'obtient en amorçant le tour de
   l'assistant par une accolade — le modèle ne peut alors que poursuivre l'objet.
   C'est plus fiable qu'une consigne dans le prompt, et ça évite les ```json.

   `max_tokens` était ici la seule borne du projet, codée en dur à 4096 — et
   uniquement parce que l'API l'exige, pas par choix. Elle vient désormais du
   réglage llm_max_tokens, partagé avec le dialecte OpenAI : une valeur, un seul
   endroit où la changer. */

import { parseJsonLoose } from "./jsonLoose.js";
import { fetchBounded, waitBeforeRetry, readUsage, RETRY_BUDGET_MS } from "./limits.js";

const VERSION = "2023-06-01";

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
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [
      { role: "user", content: user },
      { role: "assistant", content: "{" },
    ],
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchBounded(`${trim(provider.baseUrl)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": VERSION,
      },
      body: JSON.stringify(body),
    }, timeoutMs, provider.label);

    if (!res.ok) {
      if (attempt === 0 && (res.status >= 500 || res.status === 429)) {
        if (await waitBeforeRetry(res.retryAfter, attempt, retryBudgetMs, provider.label, res.status)) continue;
      }
      throw new Error(`${provider.label} HTTP ${res.status} ${res.text.slice(0, 200)}`);
    }
    const data = res.json();
    if (data.error) {
      if (attempt === 0 && await waitBeforeRetry(null, attempt, retryBudgetMs, provider.label, 200)) continue;
      throw new Error(`${provider.label} : ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
    }
    /* Anthropic nomme ses compteurs input_tokens / output_tokens ; readUsage
       connaît les deux conventions. Aucun coût n'est renvoyé, `cost` restera
       donc null — c'est traité comme « inconnu », pas comme « gratuit ». */
    if (onUsage) onUsage(readUsage(data.usage));

    /* L'accolade d'amorce ne fait pas partie de la réponse : elle a été écrite
       par nous, le modèle reprend juste après. Il faut donc la recoller. */
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = parseJsonLoose("{" + text);
    if (parsed) return parsed;
    if (attempt === 0) continue;
    throw new Error(`Réponse non parsable en JSON (${provider.label}, modèle ${mdl})`);
  }
  throw new Error(`${provider.label} : échec après 2 tentatives`);
}

/* Même contrat que ping() du dialecte OpenAI : un token, statut seul, aucun
   rejeu ; une erreur HTTP est rendue, pas levée. */
export async function ping(provider, model, { timeoutMs = 30000 } = {}) {
  const res = await fetchBounded(`${trim(provider.baseUrl)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": provider.apiKey, "anthropic-version": VERSION },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
  }, timeoutMs, provider.label);
  if (!res.ok) return { ok: false, status: res.status, message: res.text.slice(0, 300) };
  let data;
  try { data = res.json(); } catch (err) { return { ok: false, status: res.status, message: err.message }; }
  const usage = readUsage(data.usage);
  if (data.error) return { ok: false, status: res.status, message: String(data.error.message || JSON.stringify(data.error)).slice(0, 300), usage };
  return { ok: true, status: res.status, usage };
}

/* `GET {baseUrl}/models` rend la même forme `{ data: [{ id }] }` que le dialecte
   OpenAI, mais exige les deux en-têtes propres à Anthropic. */
export async function listModels(provider, { timeoutMs = 30000 } = {}) {
  const res = await fetchBounded(`${trim(provider.baseUrl)}/models?limit=1000`, {
    headers: { "x-api-key": provider.apiKey || "", "anthropic-version": VERSION },
  }, timeoutMs, provider.label);
  if (!res.ok) throw new Error(`${provider.label} HTTP ${res.status} ${res.text.slice(0, 200)}`);
  const data = res.json();
  return (Array.isArray(data.data) ? data.data : []).map((m) => m.id).filter(Boolean);
}

const trim = (u) => String(u || "").replace(/\/+$/, "");
