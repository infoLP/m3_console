/* M3-76 — zones couvertes : lecture de la liste, libellés, et validation des
   réglages (shared/zones.js, SETTING_SPECS / checkCoherence). */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ZONES, parseZones, coveredOf, coverageLabel, mainRegionName, coverageByRegion, zoneText, parseZoneText, zoneChoices } from "../shared/zones.js";
import { setSourceUrl, SOURCE_TYPES } from "../shared/sources.js";
import { SETTING_SPECS, checkCoherence } from "../src/lib/yamlStore.js";

test("défaut : les 12 départements de Nouvelle-Aquitaine, et le réglage le reprend", () => {
  assert.equal(DEFAULT_ZONES.length, 12);
  assert.equal(SETTING_SPECS.zones_covered.default, "16,17,19,23,24,33,40,47,64,79,86,87");
  assert.equal(SETTING_SPECS.region, undefined, "remplacé par la couverture");
  assert.equal(SETTING_SPECS.region_num, undefined, "lu par rien");
});

test("parseZones : séparateurs, doublons, casse, ordre du référentiel", () => {
  assert.deepEqual(parseZones("17; 16 ,17  2a"), ["16", "17", "2A"]);
  assert.deepEqual(parseZones(["85", "17"]), ["17", "85"]);
});

test("parseZones : un code inconnu ou une liste vide est refusé, pas ignoré", () => {
  assert.throws(() => parseZones("17,99"), /inconnu.*99/);
  assert.throws(() => parseZones(" , "), /au moins un/);
});

test("coveredOf retombe sur le défaut si la valeur est absente ou illisible", () => {
  assert.deepEqual(coveredOf({}), DEFAULT_ZONES);
  assert.deepEqual(coveredOf({ zones_covered: "xx" }), DEFAULT_ZONES);
  assert.deepEqual(coveredOf({ zones_covered: "17" }), ["17"]);
});

test("libellés : région entière, département seul, plusieurs régions", () => {
  assert.equal(coverageLabel(DEFAULT_ZONES), "Nouvelle-Aquitaine");
  assert.equal(coverageLabel(["17"]), "Charente-Maritime (Nouvelle-Aquitaine)");
  assert.equal(coverageLabel([...DEFAULT_ZONES, "85"]), "Nouvelle-Aquitaine, Vendée (Pays de la Loire)");
  assert.equal(mainRegionName(["17", "85", "44"]), "Pays de la Loire");
  assert.equal(coverageByRegion(DEFAULT_ZONES)[0].whole, true);
});

test("checkCoherence : le département par défaut doit être couvert", () => {
  const base = { breve_signs_min: 600, h2_above_signs: 1500, signs_max: 7000, signs_min: 1000, meta_desc_min: 70, meta_desc_max: 160 };
  assert.doesNotThrow(() => checkCoherence({ ...base, zones_covered: "17", console_default_dept: "17" }));
  assert.doesNotThrow(() => checkCoherence({ ...base, zones_covered: "17", console_default_dept: "" }));
  assert.throws(() => checkCoherence({ ...base, zones_covered: "85", console_default_dept: "17" }), /console_default_dept/);
});

/* M3-92 : saisie de la zone d'une source, partagée console + back-office. */
test("zoneText / parseZoneText : aller-retour, vide, inconnu", () => {
  assert.equal(zoneText({ dept: "17" }), "17 · Charente-Maritime");
  assert.deepEqual(parseZoneText(zoneText({ dept: "17" })), { dept: "17", region: null });
  assert.deepEqual(parseZoneText("2a"), { dept: "2A", region: null });
  assert.deepEqual(parseZoneText(zoneText({ region: "75" })), { dept: null, region: "75" });
  assert.deepEqual(parseZoneText("  "), { dept: null, region: null });
  assert.equal(parseZoneText("pas une zone"), null);
  assert.equal(parseZoneText("Région · Atlantide"), null);
  // chaque suggestion se relit
  for (const z of zoneChoices()) assert.ok(parseZoneText(z), z);
});

test("setSourceUrl : un seul champ d'URL, choisi par le type", () => {
  const s = { type: "rss", siteUrl: "https://ancien.fr" };
  setSourceUrl(s, " https://x.fr/flux ");
  assert.deepEqual(s, { type: "rss", rssUrl: "https://x.fr/flux" });
  s.type = "pdf"; setSourceUrl(s, "https://x.fr/doc.pdf");
  assert.deepEqual(s, { type: "pdf", listUrl: "https://x.fr/doc.pdf" });
  setSourceUrl(s, "");
  assert.deepEqual(s, { type: "pdf" });
  assert.ok(SOURCE_TYPES.includes("rss") && SOURCE_TYPES.includes("none"));
});
