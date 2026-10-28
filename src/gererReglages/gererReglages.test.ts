import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avecMoteurs, cleesRegleesIci, CONSEQUENCE_RETRAIT_ICONE, consequenceRetourDefaut, etatReglage, texteDefaut, valeursModifiees, basculerDept, basculerRegion, descriptionSpec, iconeTropLourde, libelleIcone, regionsPourZones, sectionsAvecCles, texteZones, valeursDe, zonesDepuisTexte } from "./gererReglages.regles";
import { checkCoherence, coerceSetting, SETTING_SPECS } from "../lib/yamlStore.js";

describe("réglages : sections", () => {
  it("range par section, « Autres » pour l'inconnu, et ne montre pas de section vide", () => {
    const secs = sectionsAvecCles({ window_hours: { type: "int", default: 72 }, mystere: { type: "string", default: "" } });
    assert.deepEqual(secs.map((s) => s.id), ["recolte", "autres"]);
    assert.deepEqual(secs[1].keys, ["mystere"]);
  });
  it("décrit un réglage par son type, ses valeurs et ses bornes", () => {
    assert.equal(descriptionSpec({ type: "int", min: 1, max: 10, default: 3 }), "entier · 1 à 10");
    assert.equal(descriptionSpec({ type: "enum", values: ["oui", "non"], default: "non" }), "oui · non");
    assert.equal(descriptionSpec({ type: "string", default: "" }), "texte");
  });
  it("valeursDe : une chaîne par réglage déclaré, jamais null", () => {
    assert.deepEqual(valeursDe({ a: 3, b: null, c: "ignoré" }, { a: { type: "int", default: 0 }, b: { type: "string", default: "" } }), { a: "3", b: "" });
  });
});

describe("zones couvertes", () => {
  it("couvertes d'abord, outre-mer à la fin, « toute la région » quand tous ses départements sont cochés", () => {
    const sel = zonesDepuisTexte("17,16");
    const r = regionsPourZones(sel);
    assert.equal(r[0].code, "75");
    assert.equal(r[0].n, 2);
    assert.equal(r[0].toute, false);
    assert.ok(r[r.length - 1].code.startsWith("0"), "l'outre-mer ferme la liste");
  });
  it("bascule d'un département et d'une région entière, aller-retour texte", () => {
    let sel = zonesDepuisTexte("17");
    sel = basculerDept(sel, "16", true);
    assert.equal(texteZones(sel), "17,16");
    sel = basculerRegion(sel, "75", true);
    assert.equal(regionsPourZones(sel)[0].toute, true);
    sel = basculerRegion(sel, "75", false);
    assert.equal(sel.size, 0);
  });
});

describe("icône du site", () => {
  it("libellé et borne de taille", () => {
    assert.equal(libelleIcone({ type: "image/svg+xml", bytes: 2048, etag: "x" }), "SVG · 2 Ko");
    assert.match(libelleIcone(null), /Aucune icône/);
    assert.equal(iconeTropLourde(100), null);
    assert.match(iconeTropLourde(300 * 1024) ?? "", /300 Ko/);
  });
});

describe("réglages qui désignent un moteur (M3-88)", () => {
  const specs = { llm_fallback_provider: { type: "string", default: "aucun" }, window_hours: { type: "int", default: 72 } };
  it("proposés en liste : « aucun », puis les moteurs du registre", () => {
    const s = avecMoteurs(specs, [{ id: "openrouter" }, { id: "openai" }], { llm_fallback_provider: "openai" });
    assert.deepEqual(s.llm_fallback_provider.values, ["aucun", "openrouter", "openai"]);
    assert.equal(s.window_hours.values, undefined, "les autres réglages ne changent pas");
  });
  it("un moteur réglé puis supprimé du registre reste affiché, pour ne pas être effacé en silence", () => {
    const s = avecMoteurs(specs, [], { llm_fallback_provider: "disparu" });
    assert.deepEqual(s.llm_fallback_provider.values, ["aucun", "disparu"]);
  });
});

describe("moteur de relecture (M3-89)", () => {
  it("propose « aucun », « mock » (relecture gratuite) puis le registre", () => {
    const s = avecMoteurs({ llm_review_provider: { type: "string", default: "aucun" } }, [{ id: "anthropic" }]);
    assert.deepEqual(s.llm_review_provider.values, ["aucun", "mock", "anthropic"]);
  });
});

describe("réglé ici contre valeur du moteur (M3-109, B2)", () => {
  it("« Enregistrer » n'envoie que les valeurs modifiées", () => {
    assert.deepEqual(valeursModifiees({ a: "1", b: "x", c: "" }, { a: "1", b: "y", c: "" }), { b: "x" });
    assert.deepEqual(valeursModifiees({ a: "1" }, { a: "1" }), {});
  });
  it("étiquette : « réglé ici » si la clé est en base, sinon « valeur par défaut »", () => {
    const reglees = new Set(["window_hours"]);
    assert.deepEqual(etatReglage("window_hours", reglees), { regle: true, libelle: "réglé ici" });
    assert.deepEqual(etatReglage("signs_max", reglees), { regle: false, libelle: "valeur par défaut" });
  });
  it("réglé ici : en base ET différent du défaut (anciennes installations, tout était enregistré)", () => {
    const specs = { window_hours: { type: "int", default: 72 }, signs_max: { type: "int", default: 7000 }, llm_regen_engines: { type: "string", default: "" } };
    const ici = cleesRegleesIci(["window_hours", "signs_max", "llm_regen_engines"], { window_hours: "48", signs_max: "7000", llm_regen_engines: "" }, specs);
    assert.deepEqual([...ici], ["window_hours"]);
    assert.deepEqual([...cleesRegleesIci(["inconnue"], { inconnue: "x" }, specs)], []);
  });
  it("conséquence écrite du retour au défaut, défaut vide lisible", () => {
    assert.match(consequenceRetourDefaut("Fenêtre de récolte", { type: "int", default: 72 }), /^Fenêtre de récolte repassera à sa valeur par défaut : 72\./);
    assert.equal(texteDefaut({ type: "string", default: "" }), "(vide)");
    assert.match(CONSEQUENCE_RETRAIT_ICONE, /icône du site sera supprimée/);
  });
});

describe("réglages : scan des concurrents (M3-121, M3-122)", () => {
  const cles = ["competitors_scan_enabled", "competitors_scan_times", "competitors_max_articles"] as const;
  it("désactivé par défaut, à 02:30, 10 articles par concurrent", () => {
    assert.equal(SETTING_SPECS.competitors_scan_enabled.default, "non");
    assert.equal(SETTING_SPECS.competitors_scan_times.default, "02:30");
    assert.equal(SETTING_SPECS.competitors_max_articles.default, 10);
  });
  it("rangés ensemble dans la section « Scan des concurrents »", () => {
    const specs = Object.fromEntries(cles.map((k) => [k, SETTING_SPECS[k]]));
    const secs = sectionsAvecCles(specs);
    assert.deepEqual(secs.map((s) => s.id), ["concurrents"]);
    assert.deepEqual(secs[0].keys, cles);
  });
  it("articles par concurrent : entier de 1 à 50", () => {
    assert.equal(coerceSetting(SETTING_SPECS.competitors_max_articles, "25"), 25);
    assert.throws(() => coerceSetting(SETTING_SPECS.competitors_max_articles, "0"), /< 1/);
    assert.throws(() => coerceSetting(SETTING_SPECS.competitors_max_articles, "51"), /> 50/);
  });
  it("horaires validés comme schedule_times", () => {
    const defauts = Object.fromEntries(Object.entries(SETTING_SPECS).map(([k, spec]) => [k, spec.default]));
    assert.doesNotThrow(() => checkCoherence(defauts));
    assert.doesNotThrow(() => checkCoherence({ ...defauts, competitors_scan_times: "02:30, 14:30" }));
    assert.throws(() => checkCoherence({ ...defauts, competitors_scan_times: "25:00" }), (e: Error & { status?: number }) => e.status === 400 && /competitors_scan_times : « 25:00 »/.test(e.message));
    assert.throws(() => checkCoherence({ ...defauts, competitors_scan_times: " " }), /competitors_scan_times : au moins un horaire/);
  });
});

describe("réglages : effacement des articles purgés (T14)", () => {
  const spec = SETTING_SPECS.purge_retention_days;
  it("désactivé par défaut (0), rangé avec l'archivage automatique", () => {
    assert.equal(spec.default, 0);
    const secs = sectionsAvecCles({ archivage_auto_heures: SETTING_SPECS.archivage_auto_heures, purge_retention_days: spec });
    assert.deepEqual(secs.map((s) => s.id), ["feat"]);
    assert.deepEqual(secs[0].keys, ["archivage_auto_heures", "purge_retention_days"]);
  });
  it("entier de 0 à 3650 jours", () => {
    assert.equal(coerceSetting(spec, "0"), 0);
    assert.equal(coerceSetting(spec, "3650"), 3650);
    assert.throws(() => coerceSetting(spec, "-1"), /< 0/);
    assert.throws(() => coerceSetting(spec, "3651"), /> 3650/);
  });
});
