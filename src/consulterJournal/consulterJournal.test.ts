import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { depuisConsole, filtresDepuis, journalQuery, paramsDe, type Entree } from "./consulterJournal.regles";

describe("journal : filtres", () => {
  it("lus dans l'URL, avec des défauts sûrs", () => {
    assert.deepEqual(filtresDepuis({}), { category: "", level: "", origine: "", q: "", days: 7 });
    assert.deepEqual(filtresDepuis({ category: "erreur", days: "30", q: "x" }), { category: "erreur", level: "", origine: "", q: "x", days: 30 });
    assert.equal(filtresDepuis({ origine: "console" }).origine, "console");
    assert.equal(filtresDepuis({ origine: "ailleurs" }).origine, "", "une origine inconnue est ignorée");
    assert.equal(filtresDepuis({ days: "12" }).days, 7, "une période inconnue retombe sur 7 jours");
  });
  it("aller-retour URL ↔ filtres, sans paramètre pour les défauts", () => {
    assert.equal(paramsDe({ category: "", level: "", origine: "", q: "", days: 7 }), "");
    const s = paramsDe({ category: "action", level: "warn", origine: "console", q: "a b", days: 1 });
    assert.deepEqual(filtresDepuis(Object.fromEntries(new URLSearchParams(s))), { category: "action", level: "warn", origine: "console", q: "a b", days: 1 });
  });
  it("la requête porte la borne de date et le curseur", () => {
    const q = journalQuery({ category: "chaine", level: "", origine: "", q: "", days: 1 }, "c1", Date.parse("2026-10-14T12:00:00Z"));
    assert.equal(q.since, "2026-10-13T12:00:00.000Z");
    assert.equal(q.category, "chaine");
    assert.equal(q.cursor, "c1");
    assert.equal("level" in q, false);
    assert.equal("origine" in q, false);
    assert.equal(journalQuery({ category: "action", level: "", origine: "console", q: "", days: 7 }).origine, "console");
  });
  it("une action de la console se reconnaît à detail.origine (M3-96)", () => {
    const e = (p: Partial<Entree>): Entree => ({ id: 1, at: "2026-10-14T12:00:00Z", category: "action", level: "info", event: "validation", ...p });
    assert.equal(depuisConsole(e({ detail: { origine: "console", article: "a1" } })), true);
    assert.equal(depuisConsole(e({ detail: { total: 3 } })), false, "action du back-office");
    assert.equal(depuisConsole(e({ category: "erreur", detail: { origine: "console" } })), false);
  });
});
