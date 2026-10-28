/* M3-62 — plafond de dépense LLM. On teste ici la partie pure : découpage des
   périodes, cumul du registre, décision « plafond atteint ». Le branchement
   (src/llm/index.js, pipeline) demande une base et un moteur : il se vérifie en
   réel, cf. TODO. */

import test from "node:test";
import assert from "node:assert/strict";

import { periodKeys, addToLedger, emptyLedger, capReached, capsFromSettings, anyCap, capError } from "../src/llm/budget.js";
import { newUsageTotal, addUsage } from "../src/llm/limits.js";

const usage = (totalTokens, cost) => ({ promptTokens: 0, completionTokens: totalTokens, totalTokens, cost, counted: true });
const total = (...us) => us.reduce((t, u) => addUsage(t, u), newUsageTotal());

test("jour et mois à l'heure de Paris, pas en UTC", () => {
  // 31 octobre 2026, 23 h 30 UTC = 1er novembre, 0 h 30 à Paris (heure d'hiver)
  assert.deepEqual(periodKeys(Date.UTC(2026, 9, 31, 23, 30)), { day: "2026-11-01", month: "2026-11" });
  // 30 juin, 22 h 30 UTC = 1er juillet, 0 h 30 à Paris (heure d'été)
  assert.deepEqual(periodKeys(Date.UTC(2026, 5, 30, 22, 30)), { day: "2026-07-01", month: "2026-07" });
});

test("le registre cumule par jour et par mois", () => {
  const t1 = Date.UTC(2026, 9, 12, 10);
  const t2 = Date.UTC(2026, 9, 13, 10);
  let l = addToLedger(emptyLedger(), usage(1000, 0.01), t1);
  l = addToLedger(l, usage(500, 0.005), t1);
  l = addToLedger(l, usage(200, null), t2);
  assert.equal(l.days["2026-10-12"].totalTokens, 1500);
  assert.equal(l.days["2026-10-13"].cost, null, "un coût inconnu reste inconnu");
  assert.equal(l.months["2026-10"].totalTokens, 1700);
  assert.ok(Math.abs(l.months["2026-10"].cost - 0.015) < 1e-12);
  assert.equal(l.months["2026-10"].billedCalls, 3);
});

test("le registre accepte une valeur lue en base vide ou absente", () => {
  const l = addToLedger(null, usage(10, 0.001), Date.UTC(2026, 9, 12, 10));
  assert.equal(l.months["2026-10"].totalTokens, 10);
});

test("le registre ne garde que 62 jours", () => {
  let l = emptyLedger();
  for (let i = 0; i < 70; i++) l = addToLedger(l, usage(1, 0), Date.UTC(2026, 0, 1 + i, 10));
  const days = Object.keys(l.days).sort();
  assert.equal(days.length, 62);
  assert.equal(days.at(-1), "2026-03-11", "on purge les plus anciens, pas les plus récents");
});

test("plafonds à 0 : rien n'est jamais atteint", () => {
  const caps = capsFromSettings({});
  assert.equal(anyCap(caps), false);
  assert.equal(capReached({ run: total(usage(1e9, 1e6)) }, caps), null);
});

test("plafond en dollars : atteint à égalité, pas en dessous", () => {
  const caps = capsFromSettings({ llm_cap_run_usd: 1 });
  assert.equal(capReached({ run: total(usage(10, 0.99)) }, caps), null);
  const hit = capReached({ run: total(usage(10, 1)) }, caps);
  assert.equal(hit.scope, "run");
  assert.equal(hit.unit, "usd");
});

test("un coût inconnu n'atteint jamais un plafond en dollars — le plafond en tokens, si", () => {
  const run = total(usage(5000, null), usage(5000, null));
  assert.equal(capReached({ run }, capsFromSettings({ llm_cap_run_usd: 0.0001 })), null);
  const hit = capReached({ run }, capsFromSettings({ llm_cap_run_usd: 0.0001, llm_cap_run_tokens: 10000 }));
  assert.equal(hit.unit, "tokens");
});

test("plafonds jour et mois lus sur le registre", () => {
  const caps = capsFromSettings({ llm_cap_day_tokens: 1000, llm_cap_month_usd: 20 });
  assert.equal(capReached({ run: newUsageTotal(), day: total(usage(999, 0)), month: total(usage(1, 19)) }, caps), null);
  assert.equal(capReached({ day: total(usage(1000, 0)) }, caps).scope, "day");
  const m = capReached({ day: total(usage(1, 0)), month: total(usage(1, 20)) }, caps);
  assert.equal(m.scope, "month");
  assert.match(m.detail, /plafond du mois atteint/);
});

test("pas de tranche pour la période (registre neuf) : rien d'atteint", () => {
  const caps = capsFromSettings({ llm_cap_day_usd: 1, llm_cap_month_tokens: 1 });
  assert.equal(capReached({ run: newUsageTotal() }, caps), null);
});

test("action au plafond : « stop » par défaut, « mock » seulement si demandé", () => {
  assert.equal(capsFromSettings({}).action, "stop");
  assert.equal(capsFromSettings({ llm_cap_action: "mock" }).action, "mock");
  assert.equal(capsFromSettings({ llm_cap_action: "n'importe quoi" }).action, "stop");
});

test("l'erreur d'arrêt se reconnaît et refuse en 429", () => {
  const hit = capReached({ run: total(usage(10, 2)) }, capsFromSettings({ llm_cap_run_usd: 1 }));
  const err = capError(hit);
  assert.equal(err.code, "LLM_CAP");
  assert.equal(err.status, 429);
  assert.match(err.message, /plafond de la run atteint/);
});
