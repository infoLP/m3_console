/* M3-59 — regrouper les sources d'une même organisation. */

import test from "node:test";
import assert from "node:assert/strict";

import { sourceHost, organisationKey, suggestOrganisations, groupSources } from "../shared/sources.js";
import { normalizeSource } from "../src/lib/yamlStore.js";

const S = (id, url, organisation) => ({ id, name: id, siteUrl: url, organisation });

test("hôte : sans www, site d'abord, URL illisible ignorée", () => {
  assert.equal(sourceHost({ siteUrl: "https://www.larochelle.fr/actus", rssUrl: "https://feeds.x.net/r" }), "larochelle.fr");
  assert.equal(sourceHost({ siteUrl: "pas une url", rssUrl: "https://feeds.x.net/r" }), "feeds.x.net");
  assert.equal(sourceHost({}), "");
});

test("clé d'organisation : casse, accents et espaces ne séparent pas", () => {
  assert.equal(organisationKey("Mairie de  La Rochelle "), organisationKey("mairie de la rochelle"));
  assert.equal(organisationKey("Préfecture"), organisationKey("prefecture"));
  assert.equal(organisationKey(null), "");
});

test("pré-remplissage : seulement les domaines partagés, seulement les sources sans organisation", () => {
  const p = suggestOrganisations([
    S("a", "https://www.larochelle.fr/mag"),
    S("b", "https://larochelle.fr/presse"),
    S("c", "https://royan.fr"),                    // domaine seul : pas de proposition
    S("d", "https://agglo.fr/a", "Agglo de La Rochelle"),
    S("e", "https://agglo.fr/b"),                  // rejoint le groupe déjà nommé
  ]);
  assert.equal(p.get("a"), "larochelle.fr");
  assert.equal(p.get("b"), "larochelle.fr");
  assert.equal(p.has("c"), false);
  assert.equal(p.has("d"), false, "une organisation saisie n'est jamais écrasée");
  assert.equal(p.get("e"), "Agglo de La Rochelle");
});

test("groupes : membres rassemblés, sources sans organisation ni masquées ni fusionnées", () => {
  const g = groupSources([
    { id: "1", organisation: "Mairie X" },
    { id: "2" },
    { id: "3", organisation: "mairie x" },
    { id: "4" },
  ]);
  assert.deepEqual(g.map((x) => x.sources.map((s) => s.id)), [["1", "3"], ["2"], ["4"]]);
  assert.equal(g[0].label, "Mairie X", "libellé de la première occurrence");
  assert.equal(g.flatMap((x) => x.sources).length, 4, "aucune source perdue");
});

test("normalizeSource garde l'organisation, rognée, et l'omet si vide", () => {
  assert.equal(normalizeSource({ id: "s", name: "n", organisation: "  Mairie X " }, 0).organisation, "Mairie X");
  assert.equal("organisation" in normalizeSource({ id: "s", name: "n", organisation: "  " }, 0), false);
});
