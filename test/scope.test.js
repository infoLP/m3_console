/* M3-73 — contrôle de périmètre avant génération (src/generate/geo.js).
   Écarter est sans appel : chaque cas « garde » ci-dessous est un sujet local
   qu'un contrôle trop zélé perdrait. */

import test from "node:test";
import assert from "node:assert/strict";
import { scopeBeforeGeneration } from "../src/generate/geo.js";

const ex = (o) => ({ title_hint: "", facts: [], entities: [], locality: "inconnu", angle: "", ...o });

test("sujet hors Nouvelle-Aquitaine : écarté, lieux nommés", () => {
  const r = scopeBeforeGeneration(
    ex({ facts: ["La métropole de Lyon inaugure un tramway le 3 novembre."], entities: ["Métropole de Lyon"], locality: "Lyon" }),
    "Communiqué. La métropole de Lyon inaugure un tramway le 3 novembre.",
  );
  assert.equal(r.outside, true);
  assert.deepEqual(r.places, ["lyon"]);
});

test("la ponctuation ne masque pas le lieu", () => {
  const r = scopeBeforeGeneration(ex({ facts: ["À Grenoble, la ville ouvre une piscine."] }), "À Grenoble, la ville ouvre une piscine.");
  assert.equal(r.outside, true);
});

test("une commune NA dans l'extraction : gardé", () => {
  const r = scopeBeforeGeneration(ex({ facts: ["Une entreprise de Royan ouvre une agence à Paris."], locality: "Royan" }), "…");
  assert.equal(r.outside, false);
});

test("l'extraction a perdu l'ancrage, la source le garde : gardé", () => {
  const r = scopeBeforeGeneration(
    ex({ facts: ["Le salon de Paris accueille 40 exposants."] }),
    "Le salon de Paris accueille 40 exposants, dont douze entreprises de La Rochelle.",
  );
  assert.equal(r.outside, false);
});

test("la région citée dans la source : gardé", () => {
  const r = scopeBeforeGeneration(ex({ facts: ["Un plan national présenté à Paris."] }), "La Nouvelle-Aquitaine relaie un plan présenté à Paris.");
  assert.equal(r.outside, false);
});

test("mots courants seuls (réunion, lot, cher) : gardé", () => {
  const r = scopeBeforeGeneration(
    ex({ facts: ["Une réunion publique présente un lot de logements jugés trop cher par les riverains."] }),
    "Une réunion publique présente un lot de logements jugés trop cher par les riverains.",
  );
  assert.equal(r.outside, false);
});

test("outre-mer et « Euronext Paris » : portée nationale ou cotation, pas un autre lieu — gardé", () => {
  const efs = "Plus de 100 maisons du don dans l'hexagone, mais aussi en Martinique, Guadeloupe, et à la Réunion.";
  assert.equal(scopeBeforeGeneration(ex({ facts: [efs] }), efs).outside, false);
  const ants = "Appeler le 09 70 83 07 07 depuis l'Outre-Mer et l'étranger.";
  assert.equal(scopeBeforeGeneration(ex({ facts: [ants] }), ants).outside, false);
  const elior = "Elior Group (Euronext Paris – ISIN : FR 0011950732) publie ses résultats.";
  assert.equal(scopeBeforeGeneration(ex({ facts: [elior], entities: ["Euronext Paris"] }), elior).outside, false);
});

test("aucun lieu (national / inconnu) : gardé, le filet après génération décide", () => {
  assert.equal(scopeBeforeGeneration(ex({ facts: ["Le taux du livret A baisse."], locality: "national" }), "Le taux du livret A baisse.").outside, false);
  assert.equal(scopeBeforeGeneration({}, "").outside, false);
});
