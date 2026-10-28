/* Test des modèles du catalogue — « Récupérer la liste » de l'onglet LLM.

   Après la récupération du catalogue, le worker (demande `test_models`) émet un
   appel minimal vers chaque modèle et range le verdict en base, daté
   (llm_providers.model_tests, migration 015). Un modèle en échec reste visible
   au back-office, grisé, non sélectionnable, le motif en infobulle.

   Ce qui est testé : tout le catalogue d'un moteur exempté de liste blanche
   (OpenRouter, M3-68) ; pour les autres, les seuls modèles autorisés — un modèle
   hors liste n'est de toute façon pas sélectionnable, le tester serait payer
   pour rien.

   Ce que ça coûte : un token de sortie par modèle, sans rejeu. Ce sont pourtant
   de vrais appels, facturés : ils passent au registre de dépense (M3-62), et un
   plafond atteint arrête le test — les modèles restants sont « non testés », ce
   qui ne les grise pas.

   Le moteur (runModelTests) reçoit ses dépendances en paramètre : il se teste
   sans base ni réseau. testProviderModels le branche sur la base. */

import { adapterFor, withEnvFallback } from "./index.js";
import { isModelAllowedFor } from "./allowlist.js";
import { newUsageTotal, addUsage } from "./limits.js";
import { capsFromSettings, anyCap, capReached, periodKeys, readLedger, recordSpend } from "./budget.js";
import { readSettings, SETTING_SPECS } from "../lib/yamlStore.js";
import { readProviderWithKey, startModelTests, recordModelVerdict, finishModelTests } from "../lib/llmProviders.js";
import { pushCollection } from "../lib/store.js";
import { redact } from "../lib/redact.js";
import { FEATS } from "../../shared/feats.js";

/* Bornes d'un appel de test : celles du « Tester la connexion », moins le rejeu. */
export const PING_TIMEOUT_MS = 30000;

export function modelsToTest(provider) {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  return models.filter((m) => isModelAllowedFor(provider, m));
}

/* Motif lisible d'un échec, pour l'infobulle. Le statut d'abord : c'est lui qui
   dit si l'échec est passager (429, 5xx) ou durable (404, 402). Le message du
   fournisseur suit, tronqué et expurgé — il peut citer l'en-tête reçu. */
const STATUS_MOTIF = {
  400: "requête refusée",
  401: "clé refusée",
  402: "crédit insuffisant",
  403: "accès refusé",
  404: "modèle introuvable ou retiré",
  408: "délai dépassé",
  429: "limite de débit atteinte (429)",
};

export function motifOf({ status, message } = {}) {
  const base = STATUS_MOTIF[status] || (status >= 500 ? `fournisseur en erreur (${status})` : status ? `HTTP ${status}` : "injoignable");
  const detail = redact(String(message || "")).replace(/\s+/g, " ").trim().slice(0, 160);
  return detail ? `${base} — ${detail}` : base;
}

/* Pool borné : au plus `n` appels en vol. `shouldStop` est relu avant chaque
   nouvel appel — un plafond atteint n'interrompt pas les appels partis, il
   empêche les suivants (on le dépasse donc d'au plus `n` appels d'un token). */
export async function runPool(items, n, fn, shouldStop = () => false) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (await shouldStop()) return;
      /* Relu APRÈS l'attente : un autre appel a pu prendre le dernier élément. */
      if (next >= items.length) return;
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

/* Le moteur. `ping(model)` rend { ok, status, message, usage } ou lève (réseau,
   délai) ; `capHit(usageDuTest)` rend le plafond atteint ou null ; `onVerdict`
   range chaque verdict au fil de l'eau, pour la barre de progression. */
export async function runModelTests(models, { ping, concurrency = 5, capHit = async () => null, onVerdict = async () => {}, onUsage = async () => {}, now = () => new Date() }) {
  const usage = newUsageTotal();
  const results = {};
  let stopped = null;

  await runPool(models, concurrency, async (model) => {
    const started = Date.now();
    let r;
    try {
      r = await ping(model);
    } catch (err) {
      r = { ok: false, status: /délai|abort/i.test(err.message) ? 408 : null, message: err.message };
    }
    if (r.usage) {
      addUsage(usage, r.usage);
      await onUsage(r.usage);
    }
    const verdict = { ok: !!r.ok, at: now().toISOString(), ms: Date.now() - started, status: r.status ?? null };
    if (!r.ok) verdict.motif = motifOf(r);
    results[model] = verdict;
    await onVerdict(model, verdict);
  }, async () => {
    if (stopped) return true;
    const hit = await capHit(usage);
    if (hit) stopped = hit.detail;
    return !!stopped;
  });

  const verdicts = Object.values(results);
  return {
    total: models.length,
    ok: verdicts.filter((v) => v.ok).length,
    ko: verdicts.filter((v) => !v.ok).length,
    untested: models.length - verdicts.length,
    stopped,
    usage,
    results,
  };
}

/* --- branchement sur la base (worker) -------------------------------------- */

export async function testProviderModels(id) {
  const p = withEnvFallback(await readProviderWithKey(id));
  if (!p) throw Object.assign(new Error(`moteur inconnu : ${id}`), { status: 404 });
  if (!p.apiKey) throw Object.assign(new Error(`aucune clé d'API pour « ${p.label} »`), { status: 400 });

  const s = await readSettings();
  const caps = capsFromSettings(s);
  const concurrency = Number(s.llm_test_concurrency) || SETTING_SPECS.llm_test_concurrency.default;
  const models = modelsToTest(p);
  const adapter = adapterFor(p.kind);

  await startModelTests(p.id, models.length);
  let summary;
  try {
    summary = await runModelTests(models, {
      concurrency,
      ping: (model) => adapter.ping(p, model, { timeoutMs: PING_TIMEOUT_MS }),
      /* Le test compte comme une run : son propre total borne le plafond « par
         run », le registre borne le jour et le mois. */
      capHit: async (used) => {
        if (!anyCap(caps)) return null;
        const ledger = await readLedger();
        const { day, month } = periodKeys();
        return capReached({ run: used, day: ledger?.days?.[day], month: ledger?.months?.[month] }, caps);
      },
      onUsage: (u) => recordSpend(u),
      onVerdict: (model, v) => recordModelVerdict(p.id, model, v),
    });
  } finally {
    await finishModelTests(p.id, summary?.stopped || null);
  }

  await notifyDefaultModel(p, summary, s);
  const { results, ...rest } = summary;
  return { provider: p.id, ...rest };
}

/* Le modèle déjà choisi échoue au test : l'avertissement sur la carte est
   toujours là ; la notification, elle, est une FEAT (fermée par défaut). Le
   modèle n'est pas changé — un 429 peut être passager. */
async function notifyDefaultModel(p, summary, settings) {
  const v = p.defaultModel && summary.results[p.defaultModel];
  if (!v || v.ok) return;
  const f = FEATS.alerteModeleDefaut;
  if ((settings?.[f.setting] ?? f.default) === "aucun") return;
  await pushCollection("notifications", {
    id: `n-${Date.now()}-modele`, type: "llm_modele_ko", severity: "warning",
    detail: `Le modèle ${p.defaultModel} de ${p.label} a échoué au test du catalogue : ${v.motif}. Il reste sélectionné ; la génération se repliera sur le secours ou le mock s'il ne répond pas.`,
    at: new Date().toISOString(), read: false,
  });
}
