/* M3-108 — Accueil cumulatif par rôle : la composition serveur (composerAccueil)
   n'appelle QUE les lectures du palier. Un relecteur ne déclenche ni la lecture
   des exécutions, ni celle des coûts, ni celle des notifications : leurs
   données ne peuvent donc pas partir vers son navigateur. Lecteurs simulés ;
   pas de base, pas de mock de module. */

import test from "node:test";
import assert from "node:assert/strict";
import { composerAccueil } from "../../src/consulterAccueil/accueil.regles.js";

const NOW = Date.parse("2026-10-15T10:00:00Z");
function lecteurs({ casse = [], extra = [] } = {}) {
  const appels = [];
  const lire = (nom, val) => async () => { appels.push(nom); if (casse.includes(nom)) throw new Error("injoignable"); return val; };
  return {
    appels,
    lire: {
      stats: lire("stats", { pace: { medianMinutes: 4, sample: 12 } }),
      executions: lire("executions", {
        schedule: { enabled: true, next: "2026-10-16 06:30", lastRun: { slot: "2026-10-15 06:30", harvest: { items: 9 }, generation: { created: 3, cap: null } } },
        harvest: { sources: [{ name: "Mairie", ok: true, count: 4 }, { name: "Préfecture", ok: false }] },
        jobs: [{ id: 1, kind: "harvest", requestedAt: "2026-10-15T09:40:00Z", startedAt: null, finishedAt: null }],
      }),
      couts: lire("couts", { routines: [], totaux: {}, registre: null, conservees: 0 }),
      notifications: lire("notifications", { notifications: [
        { id: "n1", type: "parution_bloquee", severity: "warning", at: "2026-10-15T08:00:00Z", read: false, detail: "« Digue » : parution bloquée" },
        { id: "n2", type: "llm_plafond", severity: "error", at: "2026-10-15T07:00:00Z", read: false, detail: "plafond jour" },
        { id: "n3", type: "source_ecartee", severity: "warning", at: "2026-10-13T07:00:00Z", read: false },
        ...extra,
      ], unread: 3 + extra.length }),
    },
  };
}

test("relecteur : sa file et ce qui cloche seulement — aucune lecture des paliers au-dessus", async () => {
  const l = lecteurs();
  const a = await composerAccueil({ role: "relecteur", coutsOuverts: true, now: NOW, lire: l.lire });
  assert.deepEqual(l.appels, ["stats"]);
  assert.deepEqual([a.nuit, a.couts, a.alertes], [null, null, null]);
  assert.equal(a.rythme.medianMinutes, 4);
});

/* M3-57 (décision de l'utilisateur du 2026-10-26) : le super utilisateur voit
   l'alerte « source mise à l'écart », elle seule, sans lien vers le back-office. */
const ECARTEE = { id: "n4", type: "source_ecartee", severity: "warning", at: "2026-10-15T09:00:00Z", read: false, sourceName: "CCI", detail: "furtif refusé" };

test("super utilisateur : + cette nuit et la seule alerte source_ecartee, ni coûts ni autres alertes", async () => {
  const l = lecteurs({ extra: [ECARTEE] });
  const a = await composerAccueil({ role: "super_utilisateur", coutsOuverts: true, now: NOW, lire: l.lire });
  assert.deepEqual(l.appels.sort(), ["executions", "notifications", "stats"]);
  assert.equal(a.nuit.statut, "partielle", "une source en échec : nuit partielle");
  assert.deepEqual(a.nuit.recolte.echecs, ["Préfecture"]);
  assert.equal(a.couts, null);
  assert.deepEqual(a.alertes.map((x) => x.cle), ["source_ecartee"], "ni llm_plafond, ni parution_bloquee, ni worker");
  assert.equal(a.alertes[0].href, null, "pas de lien : le back-office lui est fermé");
  assert.equal(a.alertes[0].texte, "furtif refusé");
});

test("super utilisateur sans source écartée : section alertes vide, rien d'autre ne passe", async () => {
  const l = lecteurs();
  const a = await composerAccueil({ role: "super_utilisateur", coutsOuverts: true, now: NOW, lire: l.lire });
  assert.deepEqual(a.alertes, []);
});

test("administrateur, FEAT ouverte : + coûts et alertes (parutions bloquées et worker arrêté compris)", async () => {
  const l = lecteurs();
  const a = await composerAccueil({ role: "administrateur", coutsOuverts: true, now: NOW, lire: l.lire, libelle: (n) => n.type });
  assert.deepEqual(l.appels.sort(), ["couts", "executions", "notifications", "stats"]);
  assert.ok(a.couts);
  const cles = a.alertes.map((x) => x.cle);
  assert.deepEqual(cles.slice(0, 2).sort(), ["llm_plafond", "worker"], "les erreurs d'abord");
  assert.ok(cles.includes("parution_bloquee"));
  assert.ok(!cles.includes("source_ecartee"), "plus de 24 h : hors fenêtre");
});

test("administrateur : voit aussi source_ecartee, avec le lien du back-office", async () => {
  const l = lecteurs({ extra: [ECARTEE] });
  const a = await composerAccueil({ role: "administrateur", coutsOuverts: true, now: NOW, lire: l.lire });
  const cles = a.alertes.map((x) => x.cle);
  for (const c of ["llm_plafond", "worker", "parution_bloquee", "source_ecartee"]) assert.ok(cles.includes(c), c);
  assert.equal(a.alertes.find((x) => x.cle === "source_ecartee").href, "/admin/notifications");
});

test("administrateur, FEAT coutRoutines fermée : pas de lecture des coûts", async () => {
  const l = lecteurs();
  const a = await composerAccueil({ role: "administrateur", coutsOuverts: false, now: NOW, lire: l.lire });
  assert.ok(!l.appels.includes("couts"));
  assert.equal(a.couts, null);
});

test("lecture en échec : son seul bloc est « indisponible »", async () => {
  const l = lecteurs({ casse: ["executions", "notifications"] });
  const a = await composerAccueil({ role: "administrateur", coutsOuverts: true, now: NOW, lire: l.lire });
  assert.equal(a.nuit, "indisponible");
  assert.equal(a.alertes, "indisponible");
  assert.ok(a.couts, "les coûts restent");
});
