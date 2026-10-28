import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { duree, dureeDemande, etapeDepuis, etatDemande, frise, hm, messageFin, resumeDemande, texteDerniereChaine, type Demande, type Run } from "./lancerExecutions.regles";

const D = (p: Partial<Demande>): Demande => ({ id: 1, kind: "harvest", requestedBy: "a", requestedAt: "2026-10-14T10:05:00Z", startedAt: null, finishedAt: null, result: null, error: null, ...p });

describe("demandes au worker", () => {
  it("état : en attente, en cours, terminée, échec", () => {
    assert.equal(etatDemande(D({})).code, "en_attente");
    assert.equal(etatDemande(D({ startedAt: "x" })).code, "en_cours");
    assert.equal(etatDemande(D({ startedAt: "x", finishedAt: "y" })).code, "terminee");
    assert.equal(etatDemande(D({ startedAt: "x", finishedAt: "y", error: "bail tenu" })).code, "echec");
  });
  it("résumé et message de fin d'une récolte", () => {
    const j = D({ finishedAt: "y", result: { date: "2026-10-14", stats: { items: 7, carried: 2, setAside: 1 }, skipped: 3 } });
    assert.equal(resumeDemande(j), "7 contenus nouveaux · 3 source(s) sautée(s)");
    assert.deepEqual(messageFin(j, "harvest"), { texte: "Récupération : 7 contenus nouveaux, 2 reportés · 1 source(s) à l'écart", erreur: false });
  });
  it("message de fin d'une génération plafonnée, ou en attente", () => {
    const j = D({ kind: "generate", finishedAt: "y", result: { created: 2, skipped: 1, cap: { detail: "plafond" }, pending: 3, fallbacks: 0 } });
    const m = messageFin(j, "generate");
    assert.match(m.texte, /2 articles, 1 ignorés — ⚠ plafond, 3 candidat/);
    assert.equal(m.erreur, true);
    assert.equal(messageFin(null, "generate").erreur, true);
  });
  it("planification : créneau lisible et dernière chaîne", () => {
    assert.equal(hm("2026-10-14 13:00"), "14/10 à 13:00");
    assert.equal(texteDerniereChaine({ enabled: true, times: [], error: null, next: null, lastSlot: null, running: null, lastSkipped: null, lastRun: { slot: "2026-10-14 13:00", harvest: { items: 4 }, generation: { created: 2 } } }), "14/10 à 13:00 — 4 contenus récoltés, 2 articles générés");
  });
});

describe("frise d'étapes (M3-109, B1)", () => {
  const runs: Run[] = [
    // la collection est rangée du plus récent au plus ancien
    { id: "g", kind: "generation", at: "2026-10-15T06:40:00Z", routine: "rt1", stats: { startedAt: "2026-10-15T06:33:00Z", created: 4, skipped: 1 } },
    { id: "h", kind: "harvest", at: "2026-10-15T06:32:30Z", routine: "rt1", stats: { startedAt: "2026-10-15T06:30:10Z", items: 12, ok: 20, sources: 23 } },
    { id: "s", kind: "schedule", at: "2026-10-15T06:30:00Z", routine: "rt1", stats: { slot: "2026-10-15T06:30" } },
    { id: "old", kind: "harvest", at: "2026-10-14T06:35:00Z", stats: { items: 3 } },
  ];
  it("regroupe par routine, étapes dans l'ordre chronologique, durées par étape", () => {
    const [p, ancien] = frise(runs);
    assert.equal(p.cle, "rt1");
    assert.equal(p.routine, true);
    assert.deepEqual(p.etapes.map((e) => e.kind), ["schedule", "harvest", "generation"]);
    assert.equal(p.etapes[1].dureeMs, 140_000);
    assert.equal(p.etapes[2].dureeMs, 420_000);
    assert.equal(p.dureeMs, 600_000, "du début de la chaîne à la fin de la génération");
    assert.equal(p.etapes[1].resume, "12 contenus · 20/23 sources");
    assert.equal(p.etapes[2].resume, "4 articles · 1 ignorés");
    assert.equal(ancien.routine, false);
  });
  it("un run sans startedAt (antérieur à M3-109) n'a pas de durée, et ne casse rien", () => {
    const e = etapeDepuis(runs[3]);
    assert.equal(e.debut, null);
    assert.equal(e.dureeMs, null);
    const [, ancien] = frise(runs);
    assert.equal(ancien.dureeMs, null);
    assert.equal(ancien.fin, "2026-10-14T06:35:00.000Z");
  });
  it("stats illisibles : ni exception ni durée inventée", () => {
    assert.doesNotThrow(() => frise([{ kind: "generation", at: "pas une date", stats: null }]));
    assert.equal(frise([{ kind: "generation", at: "x", stats: { startedAt: "y" } }])[0].dureeMs, null);
  });
  it("durée lisible et durée d'une demande", () => {
    assert.equal(duree(850), "850 ms");
    assert.equal(duree(42_000), "42 s");
    assert.equal(duree(185_000), "3 min 05 s");
    assert.equal(duree(3_720_000), "1 h 02 min");
    assert.equal(duree(null), "—");
    assert.equal(dureeDemande(D({ startedAt: "2026-10-14T10:05:00Z", finishedAt: "2026-10-14T10:06:30Z" })), 90_000);
    assert.equal(dureeDemande(D({ startedAt: "2026-10-14T10:05:00Z" })), null);
  });
  it("hm reste utilisé tel quel", () => assert.equal(hm("2026-10-15T06:30"), "15/10 à 06:30"));
});
