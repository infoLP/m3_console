/* M3-58 — planification : créneaux (src/schedule/slots.js) et planification par
   source (shared/sourceSchedule.js). Logique pure ; le branchement de
   l'ordonnanceur est dans scheduleWiring.test.js. */

import test from "node:test";
import assert from "node:assert/strict";

import { parseTimes, parisClock, nextAction, upcomingSlot, MAX_LATE_MINUTES } from "../src/schedule/slots.js";
import { frequencyDays, intervalOf, isDue, isQuarantined, cutoffFor, afterAttempt, QUARANTINE_AFTER } from "../shared/sourceSchedule.js";

/* Instant UTC correspondant à une heure murale de Paris, en heure d'hiver (UTC+1)
   ou d'été (UTC+2). */
const paris = (iso, offsetH) => Date.parse(iso + "Z") - offsetH * 3600000;
const DAY = 86400000;

/* --- horaires ------------------------------------------------------------ */

test("horaires : tri, doublons, écritures tolérées", () => {
  assert.deepEqual(parseTimes("13:30, 6h30;06:30 7H05").times, ["06:30", "07:05", "13:30"]);
});

test("horaires illisibles refusés avec un message", () => {
  assert.match(parseTimes("").error, /au moins un/);
  assert.match(parseTimes("25:00").error, /25:00/);
  assert.match(parseTimes("6:3").error, /6:3/);
  assert.match(parseTimes("midi").error, /midi/);
});

test("heure de Paris, été comme hiver", () => {
  assert.equal(parisClock(Date.parse("2026-07-01T04:30:00Z")).stamp, "2026-07-01 06:30");
  assert.equal(parisClock(Date.parse("2026-12-01T05:30:00Z")).stamp, "2026-12-01 06:30");
  assert.equal(parisClock(Date.parse("2026-10-31T23:30:00Z")).day, "2026-11-01", "minuit passé à Paris, pas en UTC");
});

/* --- décision de l'ordonnanceur ----------------------------------------- */

const T = ["06:30", "13:30"];

test("premier passage : on part du créneau courant sans lancer", () => {
  assert.deepEqual(nextAction(T, null, paris("2026-10-12T14:00:00", 2)), { action: "init", slot: "2026-10-12 13:30" });
});

test("créneau dû, puis plus rien jusqu'au suivant", () => {
  const now = paris("2026-10-12T06:31:00", 2);
  assert.deepEqual(nextAction(T, "2026-10-11 13:30", now), { action: "run", slot: "2026-10-12 06:30" });
  assert.deepEqual(nextAction(T, "2026-10-12 06:30", now), { action: "wait" });
  assert.deepEqual(nextAction(T, "2026-10-12 06:30", paris("2026-10-12T13:29:00", 2)), { action: "wait" });
});

test("rattrapage après un arrêt court, pas après un arrêt long", () => {
  const short = paris("2026-10-12T09:00:00", 2);           // 2 h 30 de retard
  assert.equal(nextAction(T, "2026-10-11 13:30", short).action, "run");
  const long = paris("2026-10-12T13:00:00", 2);            // 6 h 30 de retard
  assert.ok(6.5 * 60 > MAX_LATE_MINUTES);
  assert.deepEqual(nextAction(T, "2026-10-11 13:30", long), { action: "skip", slot: "2026-10-12 06:30" });
});

test("le créneau de la veille au soir est vu après minuit", () => {
  const now = paris("2026-10-13T00:10:00", 2);
  assert.deepEqual(nextAction(["23:30"], "2026-10-11 23:30", now), { action: "run", slot: "2026-10-12 23:30" });
});

test("changement d'heure d'automne : le créneau de 6 h 30 passe une seule fois", () => {
  // 25 octobre 2026 : retour à l'heure d'hiver à 3 h. 06:30 Paris = 05:30 UTC.
  const at = Date.parse("2026-10-25T05:31:00Z");
  assert.deepEqual(nextAction(["06:30"], "2026-10-24 06:30", at), { action: "run", slot: "2026-10-25 06:30" });
  assert.deepEqual(nextAction(["06:30"], "2026-10-25 06:30", at + 3600000), { action: "wait" });
});

test("prochain créneau affiché", () => {
  assert.equal(upcomingSlot(T, paris("2026-10-12T07:00:00", 2)), "2026-10-12 13:30");
  assert.equal(upcomingSlot(T, paris("2026-10-12T20:00:00", 2)), "2026-10-13 06:30");
});

/* --- intervalle par source ----------------------------------------------- */

test("fréquences réellement saisies dans le référentiel", () => {
  const cases = {
    "Mensuelle (estimée)": 7,
    "Hebdomadaire à mensuelle (estimée)": 2,
    "Mensuelle": 7,
    "Trimestrielle (estimée)": 14,
    "Quotidienne ou +": 0,
    "Plusieurs fois/semaine": 1,
    "": 0,
    "inconnue": 0,
  };
  for (const [text, days] of Object.entries(cases)) assert.equal(frequencyDays(text), days, text);
});

test("une valeur saisie l'emporte, 0 compris", () => {
  assert.deepEqual(intervalOf({ frequency: "Mensuelle", intervalDays: 0 }), { days: 0, origin: "saisi" });
  assert.deepEqual(intervalOf({ frequency: "Mensuelle", intervalDays: 3 }), { days: 3, origin: "saisi" });
  assert.deepEqual(intervalOf({ frequency: "Mensuelle" }), { days: 7, origin: "fréquence" });
  assert.deepEqual(intervalOf({}), { days: 0, origin: "défaut" });
});

test("due : jamais réussie, ou intervalle écoulé depuis le dernier succès", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  const src = { intervalDays: 7 };
  assert.equal(isDue(src, undefined, now), true);
  assert.equal(isDue(src, { lastOkAt: new Date(now - 6 * DAY).toISOString() }, now), false);
  assert.equal(isDue(src, { lastOkAt: new Date(now - 7 * DAY).toISOString() }, now), true);
  assert.equal(isDue({}, { lastOkAt: new Date(now).toISOString() }, now), true, "sans intervalle : toujours due");
});

test("la fenêtre part du dernier succès quand il est plus ancien", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  const lastOk = now - 7 * DAY;
  assert.equal(cutoffFor({ lastOkAt: new Date(lastOk).toISOString() }, 72, now), lastOk, "source hebdomadaire : rien de perdu");
  assert.equal(cutoffFor({ lastOkAt: new Date(now - 3600000).toISOString() }, 72, now), now - 72 * 3600000, "succès récent : la fenêtre globale");
  assert.equal(cutoffFor(undefined, 72, now), now - 72 * 3600000);
  assert.equal(cutoffFor(undefined, 0, now), 0, "fenêtre désactivée");
});

/* --- mise à l'écart ------------------------------------------------------ */

test("mise à l'écart au 3e échec d'affilée, notifiée une fois", () => {
  let now = Date.parse("2026-10-12T10:00:00Z");
  let st;
  const flags = [];
  for (let i = 0; i < QUARANTINE_AFTER; i++) {
    const r = afterAttempt(st, false, now);
    st = r.state; flags.push(r.quarantined);
  }
  assert.deepEqual(flags, [false, false, true]);
  assert.equal(isQuarantined(st, now + 3600000), true);
  assert.equal(isQuarantined(st, now + DAY + 1), false, "retentée après 24 h");
});

test("un succès remet le compteur à zéro et lève la mise à l'écart", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  let st = { failures: 5, quarantinedUntil: new Date(now - 1).toISOString() };
  const r = afterAttempt(st, true, now);
  assert.equal(r.state.failures, 0);
  assert.equal(r.state.quarantinedUntil, undefined);
  assert.equal(r.state.lastOkAt, new Date(now).toISOString());
});

test("un échec à la reprise remet aussitôt à l'écart", () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  const r = afterAttempt({ failures: 3, quarantinedUntil: new Date(now - 1).toISOString() }, false, now);
  assert.equal(r.quarantined, true);
});
