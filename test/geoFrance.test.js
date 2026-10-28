/* M3-75 — référentiel géographique généré par `npm run geo:build`
   (src/tools/buildGazetteer.js). Ces tests ne refont pas l'appel réseau : ils
   vérifient que les fichiers versionnés sont entiers et cohérents avec ce que le
   reste du code suppose. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { REGIONS, DEPARTEMENTS, deptsOfRegion } from "../shared/geoFrance.js";
import { NA_DEPT_NAMES } from "../shared/model.js";

const gaz = JSON.parse(fs.readFileSync(new URL("../src/generate/communes.fr.json", import.meta.url), "utf8"));

test("18 régions, 101 départements, chacun rattaché à une région connue", () => {
  assert.equal(Object.keys(REGIONS).length, 18);
  assert.equal(Object.keys(DEPARTEMENTS).length, 101);
  for (const [code, d] of Object.entries(DEPARTEMENTS)) assert.ok(REGIONS[d.region], `${code} → région ${d.region} inconnue`);
});

test("la Nouvelle-Aquitaine du référentiel est celle que le code suppose (NA_DEPT_NAMES)", () => {
  assert.equal(REGIONS["75"], "Nouvelle-Aquitaine");
  assert.deepEqual(deptsOfRegion("75"), Object.keys(NA_DEPT_NAMES).sort());
  for (const [code, name] of Object.entries(NA_DEPT_NAMES)) assert.equal(DEPARTEMENTS[code].name, name);
});

test("gazetteer : entrées complètes, au-dessus du seuil, département connu ou collectivité d'outre-mer", () => {
  assert.ok(gaz.communes.length > 3000, `${gaz.communes.length} communes seulement`);
  for (const [nom, dept, pop] of gaz.communes) {
    assert.ok(typeof nom === "string" && nom.length > 0);
    assert.ok(pop >= gaz.minPopulation, `${nom} : ${pop} < ${gaz.minPopulation}`);
    // collectivités d'outre-mer (975, 977, 978, 986, 987, 988) : pas des départements, mais des lieux
    assert.ok(DEPARTEMENTS[dept] || /^9[78]\d$/.test(dept), `${nom} : département ${dept} inconnu`);
  }
});

test("les grandes communes du 17 y sont, dans le bon département", () => {
  const of = (n) => gaz.communes.filter((c) => c[0] === n).map((c) => c[1]);
  for (const n of ["La Rochelle", "Saintes", "Rochefort", "Royan", "Saint-Jean-d'Angély", "Jonzac"]) {
    assert.deepEqual(of(n), ["17"], n);
  }
});
