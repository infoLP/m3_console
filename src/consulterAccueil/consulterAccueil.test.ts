import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertes, cetteNuit, palier, sectionsAccueil } from "./accueil.regles.js";

describe("Accueil cumulatif par rôle (M3-108)", () => {
  it("paliers : chaque rôle ajoute au précédent ; inconnu = relecteur", () => {
    assert.deepEqual([palier("relecteur"), palier("super_utilisateur"), palier("administrateur"), palier("intrus")], [0, 1, 2, 0]);
    assert.deepEqual(sectionsAccueil("relecteur", { coutsOuverts: true }), { file: true, cloche: true, nuit: false, couts: false, alertes: false });
    assert.deepEqual(sectionsAccueil("super_utilisateur", { coutsOuverts: true }), { file: true, cloche: true, nuit: true, couts: false, alertes: true }, "M3-57 : la section, filtrée à source_ecartee par composerAccueil");
    assert.deepEqual(sectionsAccueil("administrateur", { coutsOuverts: true }), { file: true, cloche: true, nuit: true, couts: true, alertes: true });
  });
  it("coûts : la FEAT reste la seule règle, même pour l'administrateur", () => {
    assert.equal(sectionsAccueil("administrateur", { coutsOuverts: false }).couts, false);
  });
  it("cette nuit : aucune, ok, partielle (récolte en échec ou plafond), échec", () => {
    assert.equal(cetteNuit({ enabled: false, lastRun: null }, null).statut, "aucune");
    const ok = cetteNuit({ lastRun: { slot: "2026-10-15 06:30", harvest: { items: 3 }, generation: { created: 1 } } }, { sources: [{ name: "A", ok: true, count: 3 }] });
    assert.equal(ok.statut, "ok");
    assert.equal(cetteNuit({ lastRun: { slot: "s", error: "récolte : base", harvest: null } }, null).statut, "partielle");
    assert.equal(cetteNuit({ lastRun: { slot: "s", harvest: { items: 2 }, generation: { created: 0, cap: { detail: "x" } } } }, { sources: [] }).statut, "partielle");
    assert.equal(cetteNuit({ lastRun: { slot: "s", error: "génération : 500", harvest: { items: 2 } } }, { sources: [] }).statut, "echec");
  });
  it("cette nuit : une récolte que la chaîne n'a pas faite ne lui est pas attribuée", () => {
    const n = cetteNuit({ lastRun: { slot: "s", error: "récolte : x", harvest: null } }, { sources: [{ name: "B", ok: false }] });
    assert.equal(n.statut === "aucune" ? null : n.recolte, null);
  });
  it("alertes : non lues, error ou warning, 24 h, regroupées, les plus graves d'abord ; worker en attente > 5 min", () => {
    const now = Date.parse("2026-10-15T10:00:00Z");
    const a = alertes({
      now,
      notifications: [
        { type: "source_ecartee", severity: "warning", at: "2026-10-15T09:00:00Z", read: false, sourceName: "S1" },
        { type: "source_ecartee", severity: "warning", at: "2026-10-15T09:30:00Z", read: false, sourceName: "S2" },
        { type: "llm_plafond", severity: "error", at: "2026-10-15T08:00:00Z", read: false, detail: "plafond" },
        { type: "doublon", severity: "info", at: "2026-10-15T09:00:00Z", read: false },
        { type: "chaine_echec", severity: "error", at: "2026-10-15T09:00:00Z", read: true },
      ],
      jobs: [{ requestedAt: "2026-10-15T09:58:00Z", startedAt: null, finishedAt: null }],
    });
    assert.deepEqual(a.map((x) => x.cle), ["llm_plafond", "source_ecartee"], "info et lues ignorées ; demande de 2 min : pas d'alerte worker");
    assert.equal(a[1].nombre, 2);
    assert.equal(a[1].texte, "S2", "le texte de la plus récente");
    const w = alertes({ now, jobs: [{ requestedAt: "2026-10-15T09:50:00Z", startedAt: null, finishedAt: null }] });
    assert.deepEqual(w.map((x) => [x.cle, x.ton]), [["worker", "stop"]]);
  });
  it("alertes : lien du back-office par défaut, aucun si href est null (super utilisateur, M3-57)", () => {
    const now = Date.parse("2026-10-15T10:00:00Z");
    const n = [{ type: "source_ecartee", severity: "warning", at: "2026-10-15T09:00:00Z", read: false }];
    assert.equal(alertes({ now, notifications: n })[0].href, "/admin/notifications");
    assert.equal(alertes({ now, notifications: n, href: null })[0].href, null);
  });
});
