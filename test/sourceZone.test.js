/* M3-78 — zone des sources : normalisation, repli du géo-tag selon le niveau,
   et correspondance commune → département pour le pré-remplissage. */

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSource } from "../src/lib/yamlStore.js";
import { sourceFallback, sourceRegion, DEFAULT_ZONES } from "../shared/zones.js";
import { detectZone, resolveCommune } from "../src/generate/geo.js";
import { zoneClassOf } from "../shared/model.js";

const src = (o) => normalizeSource({ id: "s", name: "S", ...o }, 0);

test("normalizeSource : tout département français, niveau et région validés", () => {
  assert.equal(src({ dept: "85" }).dept, "85", "plus seulement la Nouvelle-Aquitaine");
  assert.equal(src({ dept: "2a" }).dept, "2A");
  assert.equal(src({ dept: "99" }).dept, undefined, "code inconnu retiré");
  assert.equal(src({ scopeLevel: "region" }).scopeLevel, "region");
  assert.equal(src({ scopeLevel: "monde" }).scopeLevel, undefined);
  assert.equal(src({ scopeLevel: "region", region: "75" }).region, "75");
  assert.equal(src({ scopeLevel: "commune", dept: "17", region: "52" }).region, undefined, "la région se déduit du département");
});

test("repli du géo-tag selon le niveau de la source", () => {
  assert.deepEqual(sourceFallback({ scopeLevel: "commune", dept: "17" }), { dept: "17", region: null });
  assert.deepEqual(sourceFallback({ scopeLevel: "departement", dept: "17" }), { dept: "17", region: null });
  assert.deepEqual(sourceFallback({ scopeLevel: "region", region: "75" }), { dept: null, region: "75" });
  assert.deepEqual(sourceFallback({ scopeLevel: "nationale", dept: "17" }), { dept: null, region: null }, "une source nationale ne situe rien");
  assert.deepEqual(sourceFallback({ dept: "17" }), { dept: "17", region: null }, "niveau non renseigné : comportement d'avant M3-78");
  assert.equal(sourceRegion({ dept: "17" }), "75");
});

test("source régionale : portée régionale, habilitée seulement si la région est couverte", () => {
  const txt = "Le conseil a voté un plan pour les lycées.";
  const na = detectZone(txt, { sourceRegion: "75", covered: DEFAULT_ZONES });
  assert.equal(na.num, "NA");
  assert.equal(na.origin, "source");
  assert.equal(na.region, "Nouvelle-Aquitaine");
  assert.equal(zoneClassOf(na, DEFAULT_ZONES), "hab");
  const pdl = detectZone(txt, { sourceRegion: "52", covered: DEFAULT_ZONES });
  assert.equal(pdl.region, "Pays de la Loire");
  assert.equal(zoneClassOf(pdl, DEFAULT_ZONES), "nonhab");
});

test("le contenu l'emporte toujours sur la zone de la source", () => {
  const z = detectZone("Le port de La Rochelle recrute.", { sourceRegion: "52", covered: DEFAULT_ZONES });
  assert.equal(z.num, "17");
});

test("commune saisie → département : casse, « St », espaces contre traits d'union", () => {
  assert.equal(resolveCommune("LA ROCHELLE").dept, "17");
  assert.equal(resolveCommune("ST SAVINIEN").dept, "17");
  assert.equal(resolveCommune("SAINT PIERRE D'OLERON").dept, "17");
  assert.equal(resolveCommune("Bordeaux").dept, "33");
  assert.equal(resolveCommune("LOULAY"), null, "trop petite pour le gazetteer : signalée, pas devinée");
});

test("homonymes : le couvert s'il est seul, sinon ambigu", () => {
  // une commune unique est rendue telle quelle : Vienne (commune) est en Isère, le 86 n'est qu'un département
  assert.equal(resolveCommune("Vienne", ["86"]).dept, "38");
  assert.deepEqual(resolveCommune("Saint-Denis").ambiguous.sort(), ["93", "974"]);
  assert.equal(resolveCommune("Saint-Denis", ["93"]).dept, "93");
});
