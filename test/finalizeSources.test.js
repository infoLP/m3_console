/* M3-107 — checks.sources posé par finalizeGenerated : état de LA source
   (lue / illisible), émetteur nommé, citations retrouvées telles quelles. Le
   compte de citations réutilise le contrôle du drapeau citation_a_verifier
   (quoteCheck, dont alteredQuotes n'est plus qu'une vue) : les deux ne peuvent
   pas diverger. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeGenerated, alteredQuotes, quoteCheck, emitterNamed, sourceCheck, SOURCE_LISIBLE_MIN } from "../src/generate/finalize.js";

const SOURCE = "La mairie de Rochefort ouvrira une nouvelle médiathèque au printemps prochain dans le quartier de la gare. "
  + "« Nous voulons un lieu ouvert à tous les habitants du quartier », explique le maire. "
  + "Le chantier, estimé à deux millions d'euros, démarrera en janvier selon le calendrier présenté en conseil municipal. "
  + "« Ce sera aussi un espace de travail pour les étudiants », ajoute l'adjointe à la culture.";

const gen = (paras) => ({
  title: "La mairie de Rochefort ouvre une nouvelle médiathèque",
  chapo: "Un nouvel équipement culturel près de la gare.",
  body: paras.map((text) => ({ type: "p", text })),
  category: "Culture",
  seo: { metaTitle: "Rochefort : une médiathèque", metaDescription: "x".repeat(100), slug: "rochefort-mediatheque", keywords: ["a", "b", "c"] },
});

const ctx = (extra = {}) => ({ rawText: SOURCE, settings: {}, sourceName: "Ville de Rochefort", sourceUrl: "https://www.ville-rochefort.fr/actu/1", ...extra });

test("source lue : signes, émetteur nommé, citations n/m, sans drapeau", () => {
  const fin = finalizeGenerated(gen([
    "La mairie de Rochefort annonce une médiathèque. « Nous voulons un lieu ouvert à tous les habitants du quartier », explique le maire.",
    "« Ce sera aussi un espace de travail pour les étudiants », ajoute l'adjointe.",
  ]), ctx());
  assert.deepEqual(fin.checks.sources, [{
    url: "https://www.ville-rochefort.fr/actu/1", etat: "lue", signes: SOURCE.replace(/\s+/g, " ").trim().length,
    emetteurNomme: true, citations: { trouvees: 2, total: 2 },
  }]);
  assert.equal(fin.flags.some((f) => f.type === "citation_a_verifier"), false);
});

test("citation retouchée : 1/2, et le drapeau existant est inchangé", () => {
  const fin = finalizeGenerated(gen([
    "« Nous voulons un lieu ouvert à tous les habitants du quartier », explique le maire.",
    "« Ce sera surtout un grand espace de travail pour nos étudiants », ajoute l'adjointe.",
  ]), ctx());
  assert.deepEqual(fin.checks.sources[0].citations, { trouvees: 1, total: 2 });
  const f = fin.flags.find((x) => x.type === "citation_a_verifier");
  assert.ok(f);
  assert.match(f.detail, /^Absente telle quelle de la source : « Ce sera surtout un grand espace de travail pour nos étudiants »\. Rétablir/);
});

test("alteredQuotes reste la vue de quoteCheck (non-régression)", () => {
  const t = "« Nous voulons un lieu ouvert à tous » puis « un terme » puis « Ce sera surtout un espace de travail (…) pour les étudiants ».";
  assert.deepEqual(alteredQuotes(t, SOURCE), ["Ce sera surtout un espace de travail (…) pour les étudiants"]);
  /* « un terme » : moins de cinq mots, pas une parole — hors du total. */
  assert.deepEqual(quoteCheck(t, SOURCE), { total: 2, altered: ["Ce sera surtout un espace de travail (…) pour les étudiants"] });
});

test("source trop mince : illisible, citations non vérifiées", () => {
  const court = "Fermeture de la piscine municipale lundi pour travaux.";
  assert.ok(court.length <= SOURCE_LISIBLE_MIN);
  const fin = finalizeGenerated(gen(["« Une citation de plus de cinq mots inventée » dit-il."]), ctx({ rawText: court }));
  assert.deepEqual(fin.checks.sources[0], {
    url: "https://www.ville-rochefort.fr/actu/1", etat: "illisible", motif: "texte_mince", signes: court.length, emetteurNomme: true, citations: null,
  });
});

test("extraction de repli du mock (_sourceType) : illisible même avec un texte long", () => {
  const fin = finalizeGenerated(gen(["Rochefort aura sa médiathèque."]), ctx({ extracted: { _sourceType: "site" } }));
  assert.equal(fin.checks.sources[0].etat, "illisible");
  assert.equal(fin.checks.sources[0].motif, "extraction_repli");
  assert.deepEqual(fin.checks.sources[0].citations, { trouvees: 0, total: 0 });
});

test("sans nom ni adresse transmis : url et émetteur à null (appelant d'avant M3-107)", () => {
  const fin = finalizeGenerated(gen(["Rochefort aura sa médiathèque."]), { rawText: SOURCE, settings: {} });
  assert.equal(fin.checks.sources[0].url, null);
  assert.equal(fin.checks.sources[0].emetteurNomme, null);
  assert.equal(fin.checks.sources[0].etat, "lue");
});

test("les autres contrôles et drapeaux sont inchangés par checks.sources", () => {
  const g1 = gen(["« Une citation de plus de cinq mots inventée » dit-il à Rochefort."]);
  const g2 = structuredClone(g1);
  const a = finalizeGenerated(g1, ctx());
  const b = finalizeGenerated(g2, { rawText: SOURCE, settings: {} });
  const { sources: _a, ...ca } = a.checks;
  const { sources: _b, ...cb } = b.checks;
  /* M3-113 : l'attribution (R13) dépend du nom de la source — non mesurée
     sans lui. Tout le reste est identique. */
  const sansAttribution = (c) => ({ ...c, rules: { ...c.rules, checked: c.rules.checked.filter((x) => x.cle !== "attribution") } });
  assert.deepEqual(sansAttribution(ca), sansAttribution(cb));
  assert.equal(cb.rules.checked.find((x) => x.cle === "attribution").motif, "source sans nom");
  assert.deepEqual(a.flags.map((f) => [f.type, f.detail]), b.flags.map((f) => [f.type, f.detail]));
  assert.deepEqual(Object.keys(a.checks), ["date", "geo", "category", "length", "rules", "sources"]);
});

test("émetteur nommé : heuristique sur le nom de la source", () => {
  assert.equal(emitterNamed("Ville de Rochefort", "La mairie de Rochefort annonce…"), true);
  assert.equal(emitterNamed("Ville de Rochefort", "Une médiathèque ouvrira à Rochefort."), false);
  assert.equal(emitterNamed("Ville de Rochefort", "La ville de Rochefort annonce…"), true);
  assert.equal(emitterNamed("Préfecture de la Charente-Maritime", "La préfecture de Charente-Maritime a publié un arrêté."), true);
  assert.equal(emitterNamed("Préfecture", "Le préfet a signé."), false);
  assert.equal(emitterNamed("Atlantech", "Le parc ATLANTECH s'agrandit."), true);
  assert.equal(emitterNamed("Sud Ouest", "Selon le journal."), false);
  assert.equal(emitterNamed("", "texte"), null);
  assert.equal(emitterNamed(null, "texte"), null);
});

test("sourceCheck seul : forme minimale", () => {
  assert.deepEqual(sourceCheck({}), { url: null, etat: "illisible", motif: "texte_mince", signes: 0, emetteurNomme: null, citations: null });
});

/* --- M3-113 : preuves de finalize dans checks.rules.checked -------------- */

const proof = (fin, cle) => fin.checks.rules.checked.find((x) => x.cle === cle);
const CITE = "« Nous voulons un lieu ouvert à tous les habitants du quartier », explique le maire.";

test("attribution (R13) : tenue quand l'émetteur est nommé dans les deux premiers paragraphes", () => {
  const fin = finalizeGenerated(gen(["La mairie de Rochefort annonce une médiathèque.", CITE]), ctx());
  const a = proof(fin, "attribution");
  assert.equal(a.ok, true);
  assert.equal(a.retry, false);
  assert.match(a.attendu.texte, /titre, chapô ou deux premiers paragraphes/);
  assert.equal(a.obtenu.valeur, "Ville de Rochefort");
});

test("attribution (R13) : nommé au troisième paragraphe seulement → écart (portée du prompt)", () => {
  const g = gen(["Une médiathèque ouvrira près de la gare.", CITE, "La mairie de Rochefort le confirme."]);
  g.title = "Une médiathèque ouvrira près de la gare au printemps";
  const fin = finalizeGenerated(g, ctx());
  assert.equal(proof(fin, "attribution").ok, false);
  /* checks.sources garde l'ancienne mesure, sur tout le texte. */
  assert.equal(fin.checks.sources[0].emetteurNomme, true);
});

test("attribution (R13) : non mesurée sans nom de source, ou source trop mince", () => {
  const sansNom = finalizeGenerated(gen(["Rochefort aura sa médiathèque."]), { rawText: SOURCE, settings: {} });
  assert.deepEqual([proof(sansNom, "attribution").ok, proof(sansNom, "attribution").motif], [null, "source sans nom"]);
  const court = "Fermeture de la piscine municipale lundi pour travaux.";
  const mince = finalizeGenerated(gen(["La mairie de Rochefort ferme la piscine."]), ctx({ rawText: court }));
  assert.equal(proof(mince, "attribution").ok, null);
  assert.equal(proof(mince, "attribution").motif, `source de ${court.length} signes`);
});

test("citations (R14) : tenues, en écart, aucune, source mince", () => {
  const ok = proof(finalizeGenerated(gen([CITE]), ctx()), "citations");
  assert.deepEqual([ok.ok, ok.obtenu.valeur, ok.obtenu.texte], [true, 1, "1/1 mot pour mot"]);
  const ko = proof(finalizeGenerated(gen([CITE, "« Ce sera surtout un grand espace de travail pour nos étudiants », ajoute-t-elle."]), ctx()), "citations");
  assert.equal(ko.ok, false);
  assert.equal(ko.obtenu.texte, "1/2 mot pour mot");
  assert.deepEqual(ko.obtenu.absentes, ["Ce sera surtout un grand espace de travail pour nos étudiants"]);
  const zero = proof(finalizeGenerated(gen(["Rochefort aura sa médiathèque."]), ctx()), "citations");
  assert.deepEqual([zero.ok, zero.motif], [null, "aucune citation à vérifier"]);
  const court = "x".repeat(140);
  const mince = proof(finalizeGenerated(gen([CITE]), ctx({ rawText: court })), "citations");
  assert.deepEqual([mince.ok, mince.motif], [null, "source de 140 signes"]);
});

test("lieux (R15) : {lieux, absents} dans obtenu, tenue ou en écart", () => {
  const ok = proof(finalizeGenerated(gen(["La médiathèque de Rochefort ouvrira au printemps."]), ctx()), "lieux");
  assert.equal(ok.ok, true);
  assert.ok(ok.obtenu.lieux.length >= 1);
  assert.deepEqual(ok.obtenu.absents, []);
  const fin = finalizeGenerated(gen(["La médiathèque de Rochefort ouvrira au printemps, comme celle de Bordeaux."]), ctx());
  const ko = proof(fin, "lieux");
  assert.equal(ko.ok, false);
  assert.ok(ko.obtenu.absents.includes("Bordeaux"));
  assert.ok(ko.obtenu.lieux.includes("Bordeaux"));
  assert.ok(fin.flags.some((f) => f.type === "hallucination"), "drapeau inchangé");
  const mince = proof(finalizeGenerated(gen(["Saintes."]), ctx({ rawText: "court" })), "lieux");
  assert.deepEqual([mince.ok, mince.motif], [null, "source de 5 signes"]);
});

test("rubrique (R18) : checks.category toujours rempli, preuve tenue ou corrigée", () => {
  const fin = finalizeGenerated(gen(["Rochefort aura sa médiathèque."]), ctx());
  assert.deepEqual(fin.checks.category, { from: "Culture", auto: "Culture", overridden: false });
  assert.deepEqual([proof(fin, "rubrique").ok, proof(fin, "rubrique").obtenu.valeur], [true, "Culture"]);
  const g = gen(["La médiathèque de Rochefort ouvrira au printemps, près de la gare, pour les habitants."]);
  g.category = "Sport";
  const fin2 = finalizeGenerated(g, ctx());
  assert.equal(fin2.checks.category.overridden, true);
  assert.equal(fin2.checks.category.from, "Sport");
  assert.equal(fin2.checks.category.auto, g.category);
  assert.equal(proof(fin2, "rubrique").ok, false);
});

test("fenêtre de date : repli 72 h (et non plus 336) sans réglage", () => {
  const il = (j) => new Date(Date.now() - j * 86400000).toISOString();
  const neutre = "x ".repeat(150);
  const vieux = finalizeGenerated(gen(["Rochefort aura sa médiathèque."]), ctx({ rawText: neutre, publishedAt: il(12) }));
  assert.equal(vieux.checks.date.windowHours, 72);
  assert.equal(vieux.checks.date.reason, "trop_ancien", "12 j > 72 h + 7 j");
  const regle = finalizeGenerated(gen(["Rochefort aura sa médiathèque."]), ctx({ rawText: neutre, publishedAt: il(12), settings: { window_hours: 336 } }));
  assert.equal(regle.checks.date.ok, true);
});
