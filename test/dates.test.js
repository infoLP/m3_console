/* M3-71 — le contrôle de date prenait une échéance citée pour la date de parution.
   Run du 2026-10-12 : 2 articles signalés à tort, « 15 mai 2027 » (échéance MAEC
   donnée par la source) et « 17 décembre 2026 ». Cause : le simple mot « le »
   valait étiquette de parution, et toute date future au-delà de 60 jours était
   signalée, même trouvée au hasard dans le texte.
   Le cas MAEC reprend la tournure exacte de la source ; le second, non vérifié sur
   la sienne, en reprend seulement la forme probable. */

import test from "node:test";
import assert from "node:assert/strict";

import { contentDate, assessDate, dateGate } from "../src/generate/dates.js";

const NOW = new Date(2026, 9, 12, 12).getTime(); // jour de la run
const RECOLTE = "2026-10-08T09:00:00.000Z";

function check(title, raw, harvestPublishedAt = RECOLTE) {
  const cd = contentDate(title, raw);
  return assessDate({ contentDt: cd && cd.date, contentSource: cd && cd.source, harvestPublishedAt, now: NOW });
}

// Tournure exacte de la source (citée dans M3-71) ; « avant le » couvre l'ancien piège du « le ».
const MAEC = "MAEC et sécheresse : en cas de non atteinte du chargement minimum au 15 mai 2027, "
  + "les exploitants doivent déposer leur dossier avant le 15 mai 2027 auprès de la DDTM.";
const REUNION = "Réunion d'information le 17 décembre 2026 à Saintes, salle des fêtes, "
  + "pour présenter le nouveau dispositif aux agriculteurs.";

test("cas réel MAEC : une échéance citée n'est pas une date de parution", () => {
  const cd = contentDate("Mesures agro-environnementales", MAEC);
  assert.equal(cd.source, "texte", "« avant le » ne doit pas valoir étiquette");
  const r = check("Mesures agro-environnementales", MAEC);
  assert.equal(r.ok, true);
  assert.equal(r.date.toISOString(), RECOLTE, "on juge sur la date de récolte");
});

test("cas réel 17 décembre 2026 : date d'événement à +66 jours, non signalée", () => {
  assert.equal(check("Réunion MAEC", REUNION).ok, true);
});

test("date future non étiquetée et pas de date de récolte : pas de conclusion", () => {
  const r = check("Mesures agro-environnementales", MAEC, null);
  assert.deepEqual(r, { ok: true, date: null, reason: null });
});

test("une date de parution étiquetée et future reste signalée", () => {
  const r = check("Annonce", "Publié le 15 mai 2027. " + MAEC);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "future");
});

test("l'étiquette l'emporte sur l'échéance qui la suit", () => {
  const cd = contentDate("Annonce", "Publiée le 9 octobre 2026 — " + MAEC);
  assert.equal(cd.source, "label");
  assert.equal(cd.date.getMonth(), 9);
  assert.equal(cd.date.getDate(), 9);
});

test("étiquettes reconnues, accents compris", () => {
  for (const lbl of ["Publié le", "Publiée le", "Mis à jour le", "Mise à jour le",
    "Dernière mise à jour :", "Mis en ligne le", "Date de publication :"]) {
    const cd = contentDate("", `${lbl} 9 octobre 2026. Texte.`);
    assert.equal(cd && cd.source, "label", lbl);
  }
});

test("« le » seul n'est plus une étiquette, ni un mot qui finit en « le »", () => {
  assert.equal(contentDate("", "Le conseil se réunira le 3 novembre 2026.").source, "texte");
  assert.equal(contentDate("", "La commune de Rochefort-sur-Mer : salle 3 novembre 2026").source, "texte");
});

test("le contrôle « trop ancien » vaut pour toute provenance", () => {
  const lbl = check("Archive", "Publié le 3 mars 2025. Texte.");
  assert.equal(lbl.reason, "trop_ancien");
  const txt = check("Archive", "Le chantier a été livré le 3 mars 2025.");
  assert.equal(txt.reason, "trop_ancien");
});

test("une date de récolte future (métadonnée du flux) reste signalée", () => {
  const r = assessDate({ contentDt: null, harvestPublishedAt: "2027-05-15T10:00:00Z", now: NOW });
  assert.equal(r.reason, "future");
});

test("une date future non étiquetée dans la marge des 60 jours reste retenue", () => {
  const r = check("Agenda", "Concert le 20 novembre 2026 à La Rochelle.");
  assert.equal(r.ok, true);
  assert.equal(r.date.getMonth(), 10, "c'est la date du texte qui est retenue, pas la récolte");
});

test("assessDate : fenêtre par défaut = 72 h, comme le réglage (M3-113)", () => {
  const il_y_a = (j) => new Date(NOW - j * 86400000);
  /* 15 jours : hors de 72 h + 7 j ; passait avec l'ancien défaut de 336 h. */
  assert.equal(assessDate({ contentDt: il_y_a(15), now: NOW }).ok, false);
  assert.equal(assessDate({ contentDt: il_y_a(15), windowHours: 336, now: NOW }).ok, true);
  assert.equal(assessDate({ contentDt: il_y_a(5), now: NOW }).ok, true);
});

/* M3-115, piste 2 — contrôle de date AVANT la génération. Cas réel : page de
   l'Agglo de La Rochelle, « Publié le 16 sept. 2024 - Mis à jour le 17 sept. 2024 ». */
const AGGLO = "Publié le 16 sept. 2024 - Mis à jour le 17 sept. 2024. Déplacez-vous autrement avec la Semaine de la mobilité.";

test("dateGate : date de récolte hors fenêtre → écarté, motif « hors fenêtre de récupération »", () => {
  const r = dateGate({ title: "Semaine de la mobilité", rawText: "Yélo détaille ses solutions.", publishedAt: "2024-09-16T10:00:00Z", now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "trop_ancien");
  assert.match(r.detail, /16 septembre 2024.*hors fenêtre de récupération/);
});

test("dateGate : étiquette de parution ancienne dans le texte, sans date de récolte → écarté", () => {
  const r = dateGate({ title: "Semaine de la mobilité", rawText: AGGLO, publishedAt: null, now: NOW });
  assert.equal(r && r.reason, "trop_ancien");
});

test("dateGate : dans la fenêtre, ou sans date connue → rien (génération inchangée)", () => {
  assert.equal(dateGate({ title: "T", rawText: "Texte.", publishedAt: RECOLTE, now: NOW }), null);
  assert.equal(dateGate({ title: "T", rawText: "Texte sans date.", publishedAt: null, now: NOW }), null);
});

test("dateGate : une date ancienne trouvée au hasard du texte n'écarte pas (la finalisation la signale)", () => {
  const raw = "Après la crue du 12 mars 2019, la commune a renforcé ses digues.";
  assert.equal(dateGate({ title: "Digues", rawText: raw, publishedAt: null, now: NOW }), null);
  assert.equal(check("Digues", raw, null).reason, "trop_ancien", "la finalisation, elle, signale toujours");
});

test("dateGate : le futur n'écarte pas, la fenêtre du réglage est respectée", () => {
  assert.equal(dateGate({ title: "T", rawText: "Publié le 15 mai 2027.", publishedAt: null, now: NOW }), null);
  assert.equal(dateGate({ title: "T", rawText: "Texte.", publishedAt: "2026-09-20T10:00:00Z", windowHours: 72, now: NOW })?.reason, "trop_ancien");
  assert.equal(dateGate({ title: "T", rawText: "Texte.", publishedAt: "2026-09-20T10:00:00Z", windowHours: 720, now: NOW }), null);
});
