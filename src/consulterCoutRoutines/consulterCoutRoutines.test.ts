import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coutAffiche, coutMoyenArticle, coutParArticle, fmtUsd, totaux, typeRoutine } from "./coutRoutines.calcul.js";
import { resumeRoutine } from "../lib/routineContext.js";

const PARIS = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const periode = (t: number) => { const day = PARIS.format(new Date(t)); return { day, month: day.slice(0, 7) }; };
const gen = (cout: number | null, crees: number, tokens = 100) => ({ crees, cout, tokens, appels: 1, moteur: "openrouter", plafond: null });

describe("coût des routines (M3-105)", () => {
  it("coût par article : inconnu ou zéro article → null", () => {
    assert.equal(coutParArticle({ generation: gen(0.06, 3) }), 0.02);
    assert.equal(coutParArticle({ generation: gen(null, 3) }), null);
    assert.equal(coutParArticle({ generation: gen(0.06, 0) }), null);
    assert.equal(coutParArticle({ recolte: { items: 4, cout: null } }), null);
  });
  it("affichage : dollars, sinon tokens, sinon « — »", () => {
    assert.match(fmtUsd(0.0031), /0,0031/);
    assert.equal(fmtUsd(null), "—");
    assert.match(coutAffiche(gen(null, 2, 5000)), /^— \(5\s000 tokens\)$/);
    assert.equal(coutAffiche(null), "—");
  });
  it("étapes : récolte seule nommée comme telle", () => {
    assert.equal(typeRoutine({ recolte: { items: 1, cout: null }, generation: null }), "récolte seule");
    assert.equal(typeRoutine({ recolte: { items: 1, cout: null }, generation: gen(0, 0) }), "récolte + génération");
  });
  it("totaux : jour et mois à l'heure de Paris, coût inconnu compté à part", () => {
    const now = Date.parse("2026-10-15T10:00:00Z");
    const rs = [
      { at: "2026-10-15T08:00:00Z", generation: gen(0.03, 3) },
      { at: "2026-10-14T22:30:00Z", generation: gen(0.01, 1) },   // 15/10 00:30 à Paris : aujourd'hui
      { at: "2026-10-02T08:00:00Z", generation: gen(null, 2, 900) },
      { at: "2026-09-30T08:00:00Z", generation: gen(1, 10) },     // mois précédent
      { at: "2026-10-15T09:00:00Z", recolte: { items: 3, cout: null }, generation: null },
    ];
    const t = totaux(rs, now, periode);
    assert.equal(t.jour.routines, 3);
    assert.equal(t.jour.articles, 4);
    assert.ok(Math.abs(t.jour.cout - 0.04) < 1e-9);
    assert.equal(t.mois.routines, 4);
    assert.equal(t.mois.inconnus, 1);
    assert.equal(t.mois.tokens, 100 + 100 + 900);
    assert.equal(t.mois.articles, 6);
    assert.equal(t.mois.articlesCoutConnu, 4, "les 2 articles à coût inconnu ne comptent pas dans le coût moyen");
    assert.ok(Math.abs((coutMoyenArticle(t.mois) ?? 0) - 0.01) < 1e-9);
    assert.equal(coutMoyenArticle({ cout: 0, tokens: 0, articles: 2, articlesCoutConnu: 0, routines: 1, inconnus: 1 }), null);
  });
  it("résumé : coûts additionnés, mock sans usage ignoré, coût inconnu gardé null", () => {
    const r = resumeRoutine({ id: "rt", origine: "planifiee", at: "x", runs: [
      { kind: "harvest", stats: { items: 5 } },
      { kind: "generation", stats: { created: 2, provider: "openrouter", usage: { totalTokens: 300, cost: 0.02, billedCalls: 2 } } },
      { kind: "generation", stats: { created: 1, provider: "mock", usage: null } },
    ] });
    assert.deepEqual(r.recolte, { items: 5, cout: null });
    assert.deepEqual([r.generation?.crees, r.generation?.cout, r.generation?.tokens], [3, 0.02, 300]);
    const sansCout = resumeRoutine({ id: "rt", origine: "manuelle", at: "x", runs: [{ kind: "generation", stats: { created: 1, usage: { totalTokens: 80, cost: null, billedCalls: 1 } } }] });
    assert.equal(sansCout.generation?.cout, null);
    assert.equal(sansCout.statut, "ok");
  });
});
