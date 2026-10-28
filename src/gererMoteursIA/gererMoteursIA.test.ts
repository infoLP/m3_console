import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandeau, brouillonDe, estRouteur, etatSecours, etatTests, modeleSecours, modelesProposes, patchDe, TEST_PERIME_MS, testEnCours, valeurSecours, type Moteur } from "./gererMoteursIA.regles";
import { baliserPourApercu, ciblesPrompts, cleCible, erreursPrompt, etatCible, famillesVariables, filHeritage, heritage, insererVariable, modelesPourSurcharge, segmentsApercu, texteInitial, type PromptsLLM, type VersionPrompt } from "./gererMoteursIA.regles";
import { DEFAULT_TEMPLATE, PROMPT_VARIABLES, renderTemplate } from "@/llm/prompts/template.js";

const M = (p: Partial<Moteur>): Moteur => ({ id: "m", label: "Moteur", kind: "openai", baseUrl: "https://x", enabled: true, active: false, hasKey: false, ...p });

describe("modelesProposes", () => {
  it("ne propose que les modèles de la liste blanche, et garde le modèle réglé même hors liste", () => {
    const r = modelesProposes(M({ models: ["a", "b", "c"] }), ["a", "c"], "z");
    assert.deepEqual(r.usable, ["a", "c"]);
    assert.deepEqual(r.options, [{ value: "z", horsListe: true, routeur: false }, { value: "a", horsListe: false, routeur: false }, { value: "c", horsListe: false, routeur: false }]);
  });
  it("moteur exempté : tout le catalogue", () => {
    const r = modelesProposes(M({ models: ["a", "b"], allowlist: false }), ["a"], "");
    assert.equal(r.exempt, true);
    assert.deepEqual(r.usable, ["a", "b"]);
  });
});

describe("routeurs et alias", () => {
  it("repérés par une règle simple : « ~ », openrouter/auto*, « router » dans le nom", () => {
    for (const m of ["openrouter/auto", "openrouter/auto-beta", "typesafe/jev-router", "~openai/gpt-luna-latest"]) assert.equal(estRouteur(m), true, m);
    for (const m of ["mistralai/mistral-small-2603", "openai/luna", "openrouter/cypher-alpha", ""]) assert.equal(estRouteur(m), false, m);
  });
  it("proposés après les autres, marqués, et exclus des surcharges de prompt", () => {
    const p = M({ allowlist: false, models: ["openrouter/auto", "a", "~openai/x", "b"] });
    const o = modelesProposes(p, [], "").options;
    assert.deepEqual(o.map((x) => [x.value, x.routeur]), [["a", false], ["b", false], ["openrouter/auto", true], ["~openai/x", true]]);
    assert.deepEqual(modelesPourSurcharge(p), ["a", "b"]);
  });
});

describe("bandeau", () => {
  it("mock sans moteur, conseil adapté", () => {
    assert.deepEqual(bandeau({ providers: [], activeId: null, secretsAvailable: true }), { kind: "mock", conseil: "Activer un moteur" });
    assert.deepEqual(bandeau({ providers: [M({ id: "m", active: true })], activeId: "m", secretsAvailable: true }), { kind: "mock", conseil: "Renseigner la clé de « Moteur »" });
  });
  it("ok, ou hors liste", () => {
    assert.equal(bandeau({ providers: [M({ hasKey: true, defaultModel: "a", modelAllowed: true })], activeId: "m", secretsAvailable: true }).kind, "ok");
    assert.equal(bandeau({ providers: [M({ hasKey: true, defaultModel: "a", modelAllowed: false })], activeId: "m", secretsAvailable: true }).kind, "hors_liste");
  });
});

describe("test des modèles", () => {
  const T0 = Date.parse("2026-10-14T10:00:00Z");
  const iso = (dMs: number) => new Date(T0 + dMs).toISOString();
  const res = { a: { ok: true, at: iso(1000) }, b: { ok: false, at: iso(2000), motif: "modèle introuvable ou retiré" } };

  const fini = { startedAt: iso(0), finishedAt: iso(9000), total: 3, results: res };

  it("un échec est retiré de la liste ; un modèle non testé reste proposé ; le catalogue est intact", () => {
    const p = M({ allowlist: false, models: ["a", "b", "c"], modelTests: fini });
    const r = modelesProposes(p, [], "");
    assert.deepEqual(r.options.map((x) => x.value), ["a", "c"]);
    assert.deepEqual(r.disponibles, ["a", "c"]);
    assert.equal(r.ecartes, 1);
    assert.deepEqual(r.models, ["a", "b", "c"], "le catalogue n'est pas élagué");
  });
  it("le modèle déjà choisi reste visible même en échec, avec son motif", () => {
    const p = M({ allowlist: false, models: ["a", "b", "c"], modelTests: fini });
    const o = modelesProposes(p, [], "b").options;
    assert.deepEqual(o.map((x) => [x.value, x.ko ?? null]), [["b", "modèle introuvable ou retiré"], ["a", null], ["c", null]]);
  });
  it("test en cours : aucune liste, seulement le modèle choisi", () => {
    const p = M({ allowlist: false, models: ["a", "b", "c"], modelTests: { startedAt: new Date().toISOString(), total: 3, results: res } });
    const r = modelesProposes(p, [], "c");
    assert.equal(r.enTest, true);
    assert.deepEqual(r.options.map((x) => x.value), ["c"]);
    assert.deepEqual(modelesProposes(p, [], "").options, []);
  });
  it("phases : aucun, attente, en cours, fini, interrompu, arrêté au plafond", () => {
    assert.equal(etatTests(M({})).phase, "aucun");
    assert.equal(etatTests(M({ modelTests: { queuedAt: iso(0) } }), T0 + 1000).phase, "attente");
    assert.deepEqual(etatTests(M({ modelTests: { startedAt: iso(0), total: 3, results: res } }), T0 + 5000), { phase: "en_cours", total: 3, faits: 2, ko: 1 });
    const fini = etatTests(M({ modelTests: { startedAt: iso(0), finishedAt: iso(9000), total: 3, stopped: "plafond du jour atteint", results: res } }), T0 + 10000);
    assert.equal(fini.phase, "fini");
    assert.equal(fini.phase === "fini" && fini.stopped, "plafond du jour atteint");
    const perdu = etatTests(M({ modelTests: { startedAt: iso(0), total: 3, results: res } }), T0 + TEST_PERIME_MS + 1);
    assert.equal(perdu.phase === "fini" && perdu.interrompu, true);
  });
  it("un nouveau dépôt après un test fini repasse « en attente »", () => {
    const p = M({ modelTests: { startedAt: iso(0), finishedAt: iso(9000), queuedAt: iso(20000), total: 3, results: res } });
    assert.equal(etatTests(p, T0 + 21000).phase, "attente");
    assert.equal(testEnCours({ ...p, modelTests: { ...p.modelTests, queuedAt: iso(-1) } }), false);
  });
});

describe("patchDe", () => {
  it("n'envoie la clé que si elle est saisie", () => {
    const b = brouillonDe(M({ defaultModel: "a" }));
    assert.equal("apiKey" in patchDe(b), false);
    assert.equal(patchDe({ ...b, apiKey: "  sk-1 " }).apiKey, "sk-1");
  });
});

describe("moteur de secours (M3-88)", () => {
  const m = (p: Moteur, secoursId: string | null) => ({ providers: [p], activeId: null, secretsAvailable: true, secoursId });
  it("rien si le moteur n'est pas désigné", () => {
    assert.equal(etatSecours(M({ id: "a" }), m(M({ id: "a" }), "b")), null);
  });
  it("utilisable, ou inopérant avec son motif", () => {
    const ok = M({ id: "s", hasKey: true, defaultModel: "x" });
    assert.deepEqual(etatSecours(ok, m(ok, "s")), { ok: true });
    assert.match(etatSecours({ ...ok, active: true }, m(ok, "s"))?.motif ?? "", /même moteur et même modèle/);
    assert.match(etatSecours({ ...ok, hasKey: false }, m(ok, "s"))?.motif ?? "", /sans clé/);
    assert.match(etatSecours({ ...ok, enabled: false }, m(ok, "s"))?.motif ?? "", /désactivé/);
  });
  it("inopérant si son modèle a échoué au dernier test", () => {
    const ko = M({ id: "s", hasKey: true, defaultModel: "x", modelTests: { startedAt: "2026-10-14T10:00:00Z", results: { x: { ok: false, at: "2026-10-14T10:00:01Z", motif: "limite de débit atteinte (429)" } } } });
    assert.match(etatSecours(ko, m(ko, "s"))?.motif ?? "", /dernier test \(limite de débit/);
  });
  it("moteur + modèle : le moteur actif avec un autre modèle est un vrai secours", () => {
    const actif = M({ id: "or", active: true, hasKey: true, defaultModel: "mistral/small" });
    const avec = (secoursModel: string | null) => ({ providers: [actif], activeId: "or", secretsAvailable: true, secoursId: "or", secoursModel });
    assert.deepEqual(etatSecours(actif, avec("openai/luna")), { ok: true });
    assert.equal(modeleSecours(actif, avec("openai/luna")), "openai/luna");
    assert.equal(modeleSecours(actif, avec(null)), "mistral/small", "sans modèle réglé : celui du moteur");
    assert.match(etatSecours(actif, avec(null))?.motif ?? "", /même moteur et même modèle/);
  });
  it("le verdict du test porte sur le modèle du secours, pas sur celui du moteur", () => {
    const p = M({ id: "s", hasKey: true, defaultModel: "x", modelTests: { startedAt: "2026-10-14T10:00:00Z", results: { y: { ok: false, at: "2026-10-14T10:00:01Z", motif: "modèle retiré" } } } });
    const avec = { providers: [p], activeId: null, secretsAvailable: true, secoursId: "s", secoursModel: "y" };
    assert.match(etatSecours(p, avec)?.motif ?? "", /modèle retiré/);
  });
  it("retirer le secours écrit « aucun »", () => {
    assert.equal(valeurSecours(null), "aucun");
    assert.equal(valeurSecours("openai"), "openai");
  });
});

describe("prompts de génération (M3-56)", () => {
  const V = (p: Partial<VersionPrompt>): VersionPrompt => ({ id: "1", providerId: null, model: null, template: "x", createdAt: "2026-10-15T08:00:00Z", createdBy: "admin", version: 1, ...p });
  const tpl = (m: string) => `${m}\n${DEFAULT_TEMPLATE}`;
  const data = (prompts: VersionPrompt[]): PromptsLLM => ({ prompts, variables: [], required: [], defaultTemplate: DEFAULT_TEMPLATE, outputFormat: "", maxLength: 30000 });
  const OR = M({ id: "or", label: "OpenRouter", defaultModel: "m/a", models: ["m/a", "m/b"] });

  it("portées : général, chaque moteur, puis les modèles surchargés et ceux ajoutés à l'écran", () => {
    const d = data([V({ id: "2", providerId: "or", model: "m/b", template: tpl("B") }), V({ id: "3", providerId: "or", model: "m/c", template: null })]);
    const c = ciblesPrompts(d, [OR], [{ providerId: "or", model: " m/z " }]);
    assert.deepEqual(c.map((x) => x.libelle), ["Prompt général", "OpenRouter — tout le moteur", "OpenRouter — m/b", "OpenRouter — m/z"], "surcharge supprimée (m/c) absente");
    assert.equal(c[2].courant?.id, "2");
    assert.equal(c[3].courant, null);
    assert.equal(c[2].cle, cleCible("or", "m/b"));
  });

  it("héritage : un modèle sans surcharge hérite du moteur, puis du général, puis du code", () => {
    const d = data([V({ id: "1", template: tpl("G"), version: 2 }), V({ id: "2", providerId: "or", template: tpl("M"), version: 1 })]);
    const [g, moteur] = ciblesPrompts(d, [OR], [{ providerId: "or", model: "m/a" }]);
    const modele = ciblesPrompts(d, [OR], [{ providerId: "or", model: "m/a" }])[2];
    assert.equal(heritage(modele, d).source, "surcharge du moteur (version 1)");
    assert.ok(texteInitial(modele, d).startsWith("M\n"));
    assert.equal(heritage(moteur, d).source, "prompt général (version 2)");
    assert.equal(heritage(g, d).source, "prompt par défaut du code");
    assert.ok(texteInitial(g, d).startsWith("G\n"), "le général affiche sa propre version");
    assert.equal(etatCible(modele, d), "Aucune surcharge propre — s'applique : surcharge du moteur (version 1).");
    assert.match(etatCible(g, d), /version 2, par admin/);
  });

  it("insérer une variable remplace la sélection et place le curseur après", () => {
    assert.deepEqual(insererVariable("abcd", 1, 3, "zone"), { texte: "a{{zone}}d", curseur: 9 });
    assert.deepEqual(insererVariable("ab", 99, 99, "zone"), { texte: "ab{{zone}}", curseur: 10 });
  });

  it("validation à l'écran = validation du serveur", () => {
    assert.deepEqual(erreursPrompt(DEFAULT_TEMPLATE), []);
    assert.ok(erreursPrompt("{{inconnue}}").some((e) => /variable inconnue/.test(e)));
    assert.ok(erreursPrompt(`${DEFAULT_TEMPLATE}\nRéponds en JSON :`).some((e) => /verrouillé/.test(e)));
  });

  it("fil d'héritage (M3-111) : du niveau édité au défaut du code, un seul maillon en vigueur", () => {
    const d = data([V({ id: "1", template: tpl("G") }), V({ id: "2", providerId: "or", template: tpl("M") })]);
    const modele = ciblesPrompts(d, [OR], [{ providerId: "or", model: "m/a" }])[2];
    assert.deepEqual(filHeritage(modele, d, [OR]).map((m) => [m.libelle, m.etat]), [
      ["Modèle m/a", "vide"], ["Moteur OpenRouter", "en_vigueur"], ["Prompt général", "masque"], ["Défaut du code", "masque"],
    ]);
    const g = ciblesPrompts(data([]), [OR])[0];
    assert.deepEqual(filHeritage(g, data([]), [OR]).map((m) => m.etat), ["vide", "en_vigueur"]);
  });

  it("fil d'héritage : un texte invalide en base est signalé sauté, comme le fait la génération", () => {
    const d = data([V({ id: "1", template: tpl("G") }), V({ id: "2", providerId: "or", template: "{{inconnue}}" })]);
    const moteur = ciblesPrompts(d, [OR])[1];
    assert.deepEqual(filHeritage(moteur, d, [OR]).map((m) => m.etat), ["ignore", "en_vigueur", "masque"]);
  });

  it("familles de variables : chaque variable du serveur est rangée une fois, les inconnues dans « Autres »", () => {
    const vars = PROMPT_VARIABLES.map((v) => ({ ...v }));
    const f = famillesVariables(vars);
    const ranges = f.flatMap((x) => x.variables.map((v) => v.nom));
    assert.deepEqual([...ranges].sort(), vars.map((v) => v.nom).sort(), "aucune perdue, aucune en double");
    assert.ok(!f.some((x) => x.titre === "Autres"), "toutes classées");
    const avecNouvelle = famillesVariables([...vars, { nom: "nouvelle", description: "x" }]);
    assert.deepEqual(avecNouvelle.at(-1)?.variables.map((v) => v.nom), ["nouvelle"]);
  });

  it("aperçu surligné : les marques entourent la valeur rendue, puis disparaissent du texte", () => {
    const balise = baliserPourApercu("Zone : {{ zone }}. Date : {{date_source}}.");
    const rendu = renderTemplate(balise, { zone: "Vendée", date_source: "" });
    const seg = segmentsApercu(rendu);
    assert.deepEqual(seg, [
      { texte: "Zone : " }, { texte: "Vendée", variable: "zone" }, { texte: ". Date : " }, { texte: "", variable: "date_source" }, { texte: "." },
    ]);
    assert.equal(seg.map((x) => x.texte).join(""), renderTemplate("Zone : {{ zone }}. Date : {{date_source}}.", { zone: "Vendée", date_source: "" }));
    assert.deepEqual(erreursPrompt(baliserPourApercu(DEFAULT_TEMPLATE)), [], "le texte balisé passe la validation du serveur");
  });

  it("modèles proposés pour une surcharge : modèle par défaut puis catalogue, sans doublon", () => {
    assert.deepEqual(modelesPourSurcharge(OR), ["m/a", "m/b"]);
    assert.deepEqual(modelesPourSurcharge(M({ defaultModel: "z" })), ["z"]);
  });
});
