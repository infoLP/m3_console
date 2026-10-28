/* M3-113 (lot B) : la grille alignée sur les règles de la génération.
   Chaque test couvre une divergence corrigée : slug (R8), mots-clés vides (R7),
   fenêtre de la balise titre et de la méta (R5, R6, lues dans
   checks.rules.checked), plancher breve_signs_min (R1), crédit de l'illustration
   (R12), bande « fort » à 80 (R10). */

import test from "node:test";
import assert from "node:assert/strict";
import { analyze, seoComplete, rankBand, missingCriteria, recalculerScores, SEUIL_FORT_ALIGNEMENT } from "../shared/scoring.js";
import { DEFAULT_SETTINGS } from "../shared/model.js";

const S = { ...DEFAULT_SETTINGS };

/* Article qui coche les cinq critères avec les défauts. */
const conforme = () => ({
  title: "Le parc marin ouvre une maison de la mer au Verdon",
  body: [{ type: "p", text: "x".repeat(1200) }],
  ranking: 72,
  source: { type: "site", url: "https://parc-marin.fr/a" },
  illustration: { url: "https://img/a.jpg", credit: "© Parc marin" },
  seo: {
    metaTitle: "Une maison de la mer au Verdon-sur-Mer",                    // 38
    metaDescription: "Le parc marin de l'estuaire ouvre au Verdon-sur-Mer une maison de la mer, lieu d'accueil du public.",
    slug: "parc-marin-maison-mer-verdon",
    keywords: ["parc marin", "Verdon", "estuaire"],
  },
});
const avecChecked = (a, checked) => ({ ...a, checks: { rules: { attempts: 1, stopped: false, violations: [], checked } } });

test("l'article de référence est conforme", () => {
  const A = analyze(conforme(), S);
  assert.equal(A.ready, true, JSON.stringify(A));
});

test("R8 : un slug de 9 mots, ou avec un mot vide, échoue (slugRuleOk)", () => {
  const neuf = conforme(); neuf.seo.slug = "parc-marin-maison-mer-verdon-estuaire-gironde-accueil-public";
  assert.equal(seoComplete(neuf, S).slugOK, false, "9 mots > slug_max_words 6");
  assert.equal(seoComplete(neuf, { ...S, slug_max_words: 0 }).slugOK, true, "0 = sans limite");
  const vide = conforme(); vide.seo.slug = "maison-de-la-mer";
  assert.equal(seoComplete(vide, S).slugOK, false, "mot vide");
  /* L'attendu stocké prime sur le réglage actuel. */
  assert.equal(seoComplete(avecChecked(neuf, [{ cle: "slug", attendu: { max: 10, texte: "≤ 10 mots" } }]), S).slugOK, true);
});

test("R7 : un mot-clé vide ne compte pas", () => {
  const a = conforme(); a.seo.keywords = ["parc marin", "", "  "];
  const d = seoComplete(a, S);
  assert.deepEqual([d.kwOK, d.kwCount, d.kwMin], [false, 1, 3]);
});

test("R5 : la fenêtre de la balise titre stockée est appliquée (min et max)", () => {
  const court = conforme(); court.seo.metaTitle = "Maison de la mer";   // 16
  assert.equal(seoComplete(court, S).mtOK, true, "sans attendu : ≤ meta_title_max seulement");
  const fenetre = [{ cle: "balise_titre", attendu: { min: 30, max: 50, texte: "30–50 caractères" } }];
  const d = seoComplete(avecChecked(court, fenetre), S);
  assert.deepEqual([d.mtOK, d.mtMin, d.mtMax], [false, 30, 50], "16 < 30");
  const long = conforme(); long.seo.metaTitle = "y".repeat(55);
  assert.equal(seoComplete(long, S).mtOK, true, "55 ≤ 60");
  assert.equal(seoComplete(avecChecked(long, fenetre), S).mtOK, false, "55 > 50");
});

test("R6 : la fenêtre de la méta-description stockée est appliquée", () => {
  const a = conforme(); a.seo.metaDescription = "z".repeat(150);
  assert.equal(seoComplete(a, S).mdOK, true, "150 dans 70–160");
  const d = seoComplete(avecChecked(a, [{ cle: "meta", attendu: { min: 90, max: 130, texte: "90–130" } }]), S);
  assert.deepEqual([d.mdOK, d.mdMin, d.mdMax], [false, 90, 130]);
});

test("R1 : sans fenêtre, le plancher est breve_signs_min, signs_min n'existe plus", () => {
  assert.equal("signs_min" in DEFAULT_SETTINGS, false);
  const a = conforme(); a.body = [{ type: "p", text: "x".repeat(700) }];
  const A = analyze(a, S);
  assert.deepEqual([A.lengthOK, A.lengthMin], [true, 600]);
  a.body = [{ type: "p", text: "x".repeat(500) }];
  assert.equal(analyze(a, S).lengthOK, false);
});

test("R12 : le crédit est exigé avec l'URL ; la FEAT M3-93 reste inchangée", () => {
  const a = conforme(); a.illustration = { url: "https://img/a.jpg", credit: " " };
  const A = analyze(a, S);
  assert.deepEqual([A.illoOK, A.illoImage, A.illoCredit], [false, true, false]);
  assert.deepEqual(missingCriteria(a, S), ["Illustration"]);
  assert.deepEqual(missingCriteria(a, S, { sansIllustration: true }), [], "le rôle autorisé n'est pas bloqué");
  a.illustration = { url: "", credit: "© Parc" };
  assert.equal(analyze(a, S).illoOK, false, "crédit sans image");
});

test("R10 : la bande « fort » commence à 80, « Aligné » n'est plus orange", () => {
  assert.equal(SEUIL_FORT_ALIGNEMENT, 80);
  assert.equal(rankBand(79, S).key, "aligne");
  assert.equal(rankBand(80, S).key, "fort");
  assert.equal(rankBand(75, S).key, "aligne", "75 était « fort » avant M3-113");
  assert.equal(rankBand(60, S).c, "var(--go)");
  assert.equal(rankBand(59, S).key, "sous");
  assert.equal(rankBand(59, S).c, "var(--stop)");
});

test("recalculerScores : fonction pure, Paramètres complétés par les défauts", () => {
  const a = conforme(); const avant = JSON.stringify(a);
  const s = recalculerScores(a, { ranking_threshold: 60 });
  assert.equal(JSON.stringify(a), avant, "l'article n'est pas modifié");
  assert.deepEqual([s.ready, s.editorialBand, s.conformity.passed], [true, "aligne", 5]);
  a.seo.slug = "parc-marin-maison-mer-verdon-estuaire-gironde-accueil-public";
  assert.equal(recalculerScores(a).seo, "a_revoir");
});

/* Relecture M3-113 : un article qui a un `checked` est jugé sur son attendu,
   même quand un Paramètre a changé depuis ; un article ancien, sur les Paramètres. */
test("R8 : attendu de slug figé sans limite (max 0) → un slug de 9 mots reste conforme", () => {
  const a = avecChecked(conforme(), [{ cle: "slug", attendu: { max: 0, texte: "sans mot vide ni date" } }]);
  a.seo.slug = "parc-marin-maison-mer-verdon-estuaire-gironde-accueil-public";
  assert.equal(seoComplete(a, { ...S, slug_max_words: 6 }).slugOK, true, "l'attendu figé prime sur slug_max_words du jour");
  const sansMax = avecChecked(conforme(), [{ cle: "slug", attendu: { texte: "sans mot vide ni date" } }]);
  sansMax.seo.slug = a.seo.slug;
  assert.equal(seoComplete(sansMax, { ...S, slug_max_words: 6 }).slugOK, true, "checked sans max = sans limite, pas le réglage du jour");
  const ancien = conforme(); ancien.seo.slug = a.seo.slug;
  assert.equal(seoComplete(ancien, { ...S, slug_max_words: 6 }).slugOK, false, "article ancien : Paramètres actuels");
});

test("R9 : plan Hn — seuil et minimum figés, sinon Paramètres actuels", () => {
  const long = () => { const a = conforme(); a.body = [{ type: "p", text: "x".repeat(2000) }]; return a; };
  /* Ancien : 2 000 signes > h2_above_signs 1 500, aucun H2 → échoue. */
  assert.equal(seoComplete(long(), S).olOK, false);
  /* Généré avec un seuil de 3 000 : 2 000 signes, pas d'H2 exigé, même si le réglage du jour est 1 500. */
  const fige = avecChecked(long(), [{ cle: "plan_hn", attendu: { min: 1, seuil: 3000, texte: "…" } }]);
  assert.equal(seoComplete(fige, S).olOK, true);
  /* Généré avec H2 facultatifs (min 0) : conforme même si outline_h2_min vaut 1 aujourd'hui. */
  const facultatif = avecChecked(long(), [{ cle: "plan_hn", attendu: { min: 0, seuil: 1500, texte: "…" } }]);
  assert.equal(seoComplete(facultatif, S).olOK, true);
});

test("recalculerScores : sans ranking, la note éditoriale stockée est conservée, jamais 0", () => {
  const a = conforme(); delete a.ranking;
  a.scores = { editorial: 68, editorialBand: "aligne" };
  const r = recalculerScores(a, S);
  assert.equal(r.editorial, 68);
  assert.equal(r.editorialBand, "aligne");
  /* Avec un ranking, il fait foi. */
  const b = conforme(); b.scores = { editorial: 10, editorialBand: "sous" };
  assert.equal(recalculerScores(b, S).editorial, 72);
  /* Ni ranking ni note stockée : 0, comme avant. */
  const c = conforme(); delete c.ranking;
  assert.equal(recalculerScores(c, S).editorial, 0);
});
