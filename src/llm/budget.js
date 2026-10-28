/* Plafond de dépense LLM (M3-62) — par run, par jour, par mois, en dollars et en
   tokens. Six plafonds, chacun désactivé à 0, réglés dans l'onglet Paramètres.

   Unités. Les dollars sont ceux du champ `cost` d'OpenRouter (crédits OpenRouter,
   en dollars : vérifié sur la run du 2026-10-12). Un moteur qui ne renvoie aucun
   coût — Anthropic, ou un modèle gratuit qui renvoie `cost: ""` — n'alimente pas
   le compteur en dollars : seuls les plafonds en tokens le bornent. D'où les deux.

   Le jour et le mois s'entendent à l'heure de Paris : la run quotidienne tourne
   la nuit, et un découpage UTC la ferait changer de jour selon la saison.

   Ce que ce plafond ne garantit pas, et qu'il faut savoir en le réglant :
   - il se vérifie AVANT chaque appel, sur ce qui a déjà été dépensé. L'appel qui
     franchit le plafond va donc au bout : on le dépasse d'au plus un appel ;
   - deux processus qui génèrent en même temps (run quotidienne et régénération
     à la demande) lisent chacun le compteur avant l'appel de l'autre ;
   - un bogue ici, ou un appel qui ne passe pas par src/llm/index.js, n'est pas
     borné. Le seul plafond qui tienne dans tous les cas est la limite de crédit
     posée SUR LA CLÉ, chez OpenRouter. Celui-ci ne la remplace pas. */

import { readJson } from "../lib/store.js";
import { withTransaction } from "../lib/db.js";
import { newUsageTotal, addUsage } from "./limits.js";

export const SPEND_KEY = "llm/spend.json";

/* Tranches conservées : de quoi lire le mois en cours et le précédent, rien de
   plus — le détail par run vit déjà dans la collection `runs`. */
const KEEP_DAYS = 62;
const KEEP_MONTHS = 24;

const PARIS = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/* « 2026-10-12 » et « 2026-10 », à l'heure de Paris. fr-CA formate déjà en
   AAAA-MM-JJ, ce qui évite de recomposer les parties à la main. */
export function periodKeys(now = Date.now()) {
  const day = PARIS.format(new Date(now));
  return { day, month: day.slice(0, 7) };
}

export function emptyLedger() {
  return { days: {}, months: {} };
}

/* Ajoute un relevé d'usage (cf. readUsage) aux tranches du jour et du mois.
   Pure : renvoie le registre modifié, sans réseau, pour être testable. */
export function addToLedger(ledger, usage, now = Date.now()) {
  const l = ledger && typeof ledger === "object" ? ledger : emptyLedger();
  l.days = l.days || {};
  l.months = l.months || {};
  const { day, month } = periodKeys(now);
  addUsage((l.days[day] ||= newUsageTotal()), usage);
  addUsage((l.months[month] ||= newUsageTotal()), usage);
  prune(l.days, KEEP_DAYS);
  prune(l.months, KEEP_MONTHS);
  return l;
}

/* Les clés AAAA-MM-JJ et AAAA-MM se trient comme des chaînes. */
function prune(buckets, keep) {
  const keys = Object.keys(buckets).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) delete buckets[k];
}

/* Les plafonds tels que lus dans les réglages. 0 = désactivé. */
export function capsFromSettings(s = {}) {
  return {
    run: { usd: num(s.llm_cap_run_usd), tokens: num(s.llm_cap_run_tokens) },
    day: { usd: num(s.llm_cap_day_usd), tokens: num(s.llm_cap_day_tokens) },
    month: { usd: num(s.llm_cap_month_usd), tokens: num(s.llm_cap_month_tokens) },
    action: s.llm_cap_action === "mock" ? "mock" : "stop",
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function anyCap(caps) {
  return ["run", "day", "month"].some((p) => caps[p].usd > 0 || caps[p].tokens > 0);
}

const SCOPE_LABEL = { run: "de la run", day: "du jour", month: "du mois" };

/* Premier plafond atteint, ou null. `used` = { run, day, month }, chacun un total
   d'usage (newUsageTotal) ou absent. Atteint = dépensé ≥ plafond : à égalité,
   l'appel suivant le dépasserait forcément. Un coût inconnu (`null`) n'atteint
   jamais un plafond en dollars — c'est le rôle du plafond en tokens. */
export function capReached(used, caps) {
  for (const scope of ["run", "day", "month"]) {
    const u = used[scope] || newUsageTotal();
    const c = caps[scope];
    if (c.usd > 0 && u.cost != null && u.cost >= c.usd) {
      return { scope, unit: "usd", used: u.cost, cap: c.usd,
        detail: `plafond ${SCOPE_LABEL[scope]} atteint : ${fmtUsd(u.cost)} dépensés pour ${fmtUsd(c.usd)} autorisés` };
    }
    if (c.tokens > 0 && u.totalTokens >= c.tokens) {
      return { scope, unit: "tokens", used: u.totalTokens, cap: c.tokens,
        detail: `plafond ${SCOPE_LABEL[scope]} atteint : ${fmtInt(u.totalTokens)} tokens consommés pour ${fmtInt(c.tokens)} autorisés` };
    }
  }
  return null;
}

function fmtUsd(n) {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 4 })} $`;
}
function fmtInt(n) {
  return n.toLocaleString("fr-FR");
}

/* L'erreur levée quand le plafond est atteint et que l'action est « stop ».
   `code` permet à la pipeline de la distinguer d'un échec de génération ;
   `status` 429 fait répondre la régénération à la demande par un refus explicite
   plutôt que par une erreur générique. */
export function capError(hit) {
  return Object.assign(new Error(`Génération interrompue — ${hit.detail}.`), { code: "LLM_CAP", status: 429, cap: hit });
}

/* --- base -------------------------------------------------------------------- */

export async function readLedger() {
  return (await readJson(SPEND_KEY, null)) || emptyLedger();
}

/* Lire-modifier-écrire sous verrou de ligne, comme pushCollection : la run
   quotidienne et une régénération qui écrivent en même temps perdraient sinon
   l'une des deux dépenses. */
export async function recordSpend(usage, now = Date.now()) {
  await withTransaction(async (c) => {
    await c.query("INSERT INTO kv_documents (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING",
      [SPEND_KEY, JSON.stringify(emptyLedger())]);
    const { rows } = await c.query("SELECT value FROM kv_documents WHERE key = $1 FOR UPDATE", [SPEND_KEY]);
    const ledger = addToLedger(rows[0]?.value, usage, now);
    await c.query("UPDATE kv_documents SET value = $2::jsonb, updated_at = now() WHERE key = $1",
      [SPEND_KEY, JSON.stringify(ledger)]);
  });
}
