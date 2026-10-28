/* M3-77 — le géo-tag, la classe habilitée et le contrôle de M3-73 lisent la
   couverture (zones_covered) au lieu de la Nouvelle-Aquitaine codée en dur. */

import test from "node:test";
import assert from "node:assert/strict";
import { detectZone, scopeBeforeGeneration, placesIn } from "../src/generate/geo.js";
import { zoneClassOf } from "../shared/model.js";
import { DEFAULT_ZONES } from "../shared/zones.js";

const NA = DEFAULT_ZONES;
const NA_VENDEE = [...NA, "85"];

test("défaut (Nouvelle-Aquitaine) : une commune du 17 donne le 17, habilité", () => {
  const z = detectZone("Le conseil municipal de La Rochelle a voté le budget.", { covered: NA });
  assert.equal(z.num, "17");
  assert.equal(z.commune, "La Rochelle");
  assert.equal(z.region, "Nouvelle-Aquitaine");
  assert.equal(zoneClassOf(z, NA), "hab");
});

test("une commune de l'INSEE absente de la liste manuelle est reconnue (Marans, 17)", () => {
  assert.equal(detectZone("Le marché de Marans s'agrandit.", { covered: NA }).num, "17");
});

test("couverture élargie à la Vendée : Les Sables-d'Olonne devient habilité", () => {
  const txt = "Aux Sables-d'Olonne, le port de plaisance accueille le Vendée Globe.";
  const before = detectZone(txt, { covered: NA });
  assert.equal(zoneClassOf(before, NA), "nonhab", "hors zone sous la couverture par défaut");
  const after = detectZone(txt, { covered: NA_VENDEE });
  assert.equal(after.num, "85");
  assert.equal(after.region, "Pays de la Loire");
  assert.equal(zoneClassOf(after, NA_VENDEE), "hab");
});

test("couverture réduite au 17 : Bordeaux devient hors zone, La Rochelle reste", () => {
  const bx = detectZone("La métropole de Bordeaux lance un appel à projets.", { covered: ["17"] });
  assert.equal(bx.num, "HS");
  assert.equal(zoneClassOf(bx, ["17"]), "nonhab");
  assert.equal(detectZone("Le port de La Rochelle recrute.", { covered: ["17"] }).num, "17");
});

test("portée régionale : habilitée dès qu'un département de la région est couvert", () => {
  const z = { num: "NA", region: "Nouvelle-Aquitaine", regionOnly: true };
  assert.equal(zoneClassOf(z, ["17"]), "hab");
  assert.equal(zoneClassOf(z, ["85"]), "nonhab");
});

test("un département couvert l'emporte sur un ancien marquage outsideNA", () => {
  assert.equal(zoneClassOf({ num: "85", outsideNA: true }, NA_VENDEE), "hab");
  assert.equal(zoneClassOf({ num: "HS", outsideNA: true }, NA_VENDEE), "nonhab");
});

test("homonymes : le couvert d'abord (Vienne 86 et non Vienne 38)", () => {
  assert.deepEqual(Object.keys(placesIn("Le département de la Vienne investit.", NA).score), ["86"]);
});

test("mots et noms de personne ne sont pas des lieux", () => {
  // « la mer » n'est pas Mer (41) ; « Sophie Bourg » n'est pas Bourg (33)
  assert.deepEqual(placesIn("Une sortie en mer est prévue.", NA).outside, []);
  assert.deepEqual(placesIn("Sophie Bourg, directrice du marketing, a pris la parole.", NA).score, {});
  // mais « la Communauté d'Agglomération d'Épinal » cite bien Épinal
  assert.deepEqual(placesIn("Un contrat avec la Communauté d'Agglomération d'Épinal.", NA).outside, ["Épinal"]);
});

test("l'outre-mer marque une portée nationale, pas un lieu hors zone", () => {
  assert.deepEqual(placesIn("Joignable depuis l'Outre-Mer et l'étranger.", NA).outside, []);
});

test("M3-73 suit la couverture : Bordeaux écarté si seul le 17 est couvert", () => {
  const ex = { facts: ["Bordeaux inaugure un nouveau pont."], entities: ["Bordeaux"], locality: "Bordeaux" };
  const raw = "Bordeaux inaugure un nouveau pont sur la Garonne.";
  assert.equal(scopeBeforeGeneration(ex, raw, { covered: NA }).outside, false);
  assert.equal(scopeBeforeGeneration(ex, raw, { covered: ["17"] }).outside, true);
});
