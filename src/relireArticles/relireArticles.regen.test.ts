import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageRegeneration, resumeRegen, traceRelances, type ChecksRegen } from "./relireArticles.regen";

const origine = { moteur: "anthropic", modele: "claude-x", relance: false, verdict: "rejet", hallucinations: 2, motif: null };
const ok: ChecksRegen = {
  issue: "ok", retenue: 2,
  tentatives: [
    origine,
    { moteur: "mistral", modele: null, relance: true, verdict: "rejet", hallucinations: 1, motif: null },
    { moteur: "openai", modele: "luna", relance: true, verdict: "ok", hallucinations: 0, motif: null },
  ],
};
const persistante: ChecksRegen = {
  issue: "hallucination_persistante", retenue: 1,
  tentatives: [origine, { moteur: "mistral", modele: null, relance: true, verdict: "rejet", hallucinations: 1, motif: null }, { moteur: "openai", modele: "luna", relance: true, verdict: "rejet", hallucinations: 3, motif: null }],
};
const saute: ChecksRegen = {
  issue: "aucune_relance", retenue: 0,
  tentatives: [origine, { moteur: "gemini", modele: null, relance: true, verdict: null, hallucinations: null, motif: "sauté : clé absente" }, { moteur: "anthropic", modele: "claude-x", relance: true, verdict: null, hallucinations: null, motif: "sauté : même moteur et même modèle que la version rejetée" }],
};
const plafond: ChecksRegen = {
  issue: "hallucination_persistante", retenue: 1,
  tentatives: [origine, { moteur: "mistral", modele: null, relance: true, verdict: "rejet", hallucinations: 1, motif: null }, { moteur: "openai", modele: "luna", relance: true, verdict: null, hallucinations: null, motif: "plafond : dépense atteinte" }],
};

describe("traceRelances", () => {
  it("rend [] sans trace", () => {
    assert.deepEqual(traceRelances(null), []);
    assert.deepEqual(traceRelances(undefined), []);
    assert.deepEqual(traceRelances({}), []);
    assert.deepEqual(traceRelances({ tentatives: [] }), []);
  });
  it("numérote, nomme le moteur, marque la version retenue", () => {
    const l = traceRelances(ok);
    assert.equal(l.length, 3);
    assert.deepEqual(l.map((x) => x.etape), ["Version d'origine", "Relance 1", "Relance 2"]);
    assert.equal(l[0].moteur, "anthropic · claude-x");
    assert.equal(l[1].moteur, "mistral");
    assert.deepEqual(l.map((x) => x.retenue), [false, false, true]);
    assert.equal(l[0].verdict, "À rejeter");
    assert.equal(l[0].hallucinations, "2 hallucinations");
    assert.equal(l[1].hallucinations, "1 hallucination");
    assert.equal(l[2].hallucinations, "aucune hallucination");
    assert.equal(l[2].ton, "go");
    assert.equal(l[0].ton, "stop");
  });
  it("persistante : la retenue est la moins mauvaise", () => {
    assert.deepEqual(traceRelances(persistante).map((x) => x.retenue), [false, true, false]);
  });
  it("sautées : motif, pas de verdict, ton neutre", () => {
    const l = traceRelances(saute);
    assert.equal(l[1].motif, "sauté : clé absente");
    assert.equal(l[1].verdict, null);
    assert.equal(l[1].hallucinations, null);
    assert.equal(l[1].ton, "neutre");
    assert.equal(l[0].retenue, true);
  });
  it("plafond : motif conservé", () => {
    assert.equal(traceRelances(plafond)[2].motif, "plafond : dépense atteinte");
  });
  it("verdict inconnu : repris tel quel", () => {
    assert.equal(traceRelances({ tentatives: [{ moteur: "m", verdict: "bizarre", hallucinations: 0 }] })[0].verdict, "bizarre");
  });
});

describe("resumeRegen", () => {
  it("null sans stats", () => {
    assert.equal(resumeRegen(null), null);
    assert.equal(resumeRegen(undefined), null);
  });
  it("stats vides : aucune relance engagée", () => {
    const r = resumeRegen({ articles: 0, relances: 0, reussies: 0, persistantes: 0, sautes: 0, arrets: 0, suggestions: [], diagnostics: [] });
    assert.equal(r?.titre, "Relances : aucune engagée");
    assert.deepEqual(r?.lignes, []);
  });
  it("stats pleines", () => {
    const r = resumeRegen({
      articles: 3, relances: 5, reussies: 2, persistantes: 1, sautes: 1, arrets: 1,
      suggestions: ["Citer les chiffres", ""],
      diagnostics: [{ source: "Sud Ouest", vers: "openai", modele: "luna", verdict: "rejet", hallucinations: 2, resume: "Chiffres inventés", suggestion: "Citer" }, { vers: "mistral" }],
    });
    assert.equal(r?.titre, "Relances après hallucination : 3 articles");
    assert.deepEqual(r?.lignes[0], { libelle: "Articles relancés", valeur: "3" });
    assert.equal(r?.lignes.length, 6);
    assert.deepEqual(r?.suggestions, ["Citer les chiffres"]);
    assert.equal(r?.diagnostics[0].moteur, "openai · luna");
    assert.equal(r?.diagnostics[0].verdict, "À rejeter");
    assert.equal(r?.diagnostics[0].hallucinations, "2 hallucinations");
    assert.equal(r?.diagnostics[1].source, "source");
    assert.equal(r?.diagnostics[1].hallucinations, "0 hallucination");
  });
  it("champs absents ou invalides : zéros", () => {
    const r = resumeRegen({ articles: Number.NaN } as never);
    assert.equal(r?.lignes.length, 0);
    assert.deepEqual(r?.suggestions, []);
  });
});

describe("messageRegeneration", () => {
  it("null s'il n'y a rien à dire", () => {
    assert.equal(messageRegeneration(null), null);
    assert.equal(messageRegeneration(undefined), null);
    assert.equal(messageRegeneration({}), null);
    assert.equal(messageRegeneration({ issue: "ok", tentatives: [origine] }), null);
  });
  it("ok : la relance qui passe", () => {
    assert.equal(messageRegeneration(ok), "2 relances : la 2e (openai · luna) passe la relecture");
  });
  it("ok à la première relance", () => {
    const c: ChecksRegen = { issue: "ok", retenue: 1, tentatives: [origine, { moteur: "openai", modele: "luna", relance: true, verdict: "ok", hallucinations: 0, motif: null }] };
    assert.equal(messageRegeneration(c), "1 relance : la 1re (openai · luna) passe la relecture");
  });
  it("ok après un moteur sauté : le rang compte les relances faites", () => {
    const c: ChecksRegen = { issue: "ok", retenue: 2, tentatives: [origine, { moteur: "x", relance: true, motif: "sauté : clé absente" }, { moteur: "openai", modele: "luna", relance: true, verdict: "ok", hallucinations: 0, motif: null }] };
    assert.equal(messageRegeneration(c), "1 relance : la 1re (openai · luna) passe la relecture");
  });
  it("persistante", () => {
    assert.equal(messageRegeneration(persistante), "hallucination persistante après 2 relances, article signalé");
  });
  it("plafond", () => {
    assert.equal(messageRegeneration(plafond), "hallucination persistante après 1 relance (plafond de dépense atteint), article signalé");
  });
  it("aucune_relance : moteurs sautés", () => {
    assert.equal(messageRegeneration(saute), "aucune relance possible (2 moteurs sautés), article signalé");
  });
  it("issue inconnue : null", () => {
    assert.equal(messageRegeneration({ issue: "?", tentatives: [origine, { relance: true, moteur: "m" }] }), null);
  });
});
