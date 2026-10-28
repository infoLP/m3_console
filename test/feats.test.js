/* M3-83 — accès aux FEAT par rôle (shared/feats.js). M3-91 à M3-93 : les FEAT
   du weekly du 13/10. */

import test from "node:test";
import assert from "node:assert/strict";
import { FEATS, featOpen, featsFor, illustrationMissing, illustrationBlocked, hasImage, notificationVisible } from "../shared/feats.js";

test("notification « modèle choisi en échec » : fermée par défaut, visible au-dessus du seuil une fois ouverte", () => {
  const n = { type: "llm_modele_ko" };
  assert.equal(FEATS.alerteModeleDefaut.default, "aucun");
  assert.equal(notificationVisible(n, "administrateur", {}), false);
  const s = { [FEATS.alerteModeleDefaut.setting]: "super_utilisateur" };
  assert.equal(notificationVisible(n, "administrateur", s), true);
  assert.equal(notificationVisible(n, "relecteur", s), false);
  /* Les autres notifications ne dépendent d'aucune FEAT. */
  assert.equal(notificationVisible({ type: "llm_secours" }, "relecteur", {}), true);
});

/* M3-121, M3-122 : nouveaux candidats du scan des concurrents. */
test("notification « nouveaux candidats » : administrateur et super utilisateur par défaut, pas le relecteur", () => {
  const n = { type: "competitors_candidates" };
  assert.equal(FEATS.notifConcurrents.setting, "feat_notif_concurrents");
  assert.equal(FEATS.notifConcurrents.default, "super_utilisateur");
  assert.equal(notificationVisible(n, "administrateur", {}), true);
  assert.equal(notificationVisible(n, "super_utilisateur", {}), true);
  assert.equal(notificationVisible(n, "relecteur", {}), false);
  assert.equal(notificationVisible(n, "relecteur", { feat_notif_concurrents: "relecteur" }), true);
  assert.equal(notificationVisible(n, "administrateur", { feat_notif_concurrents: "aucun" }), false);
});
import { SETTING_SPECS } from "../src/lib/yamlStore.js";
import { SETTING_HELP } from "../shared/settingsHelp.js";
import { analyze } from "../shared/scoring.js";

test("chaque FEAT a son réglage, son défaut, et sa ligne d'aide", () => {
  for (const f of Object.values(FEATS)) {
    assert.equal(SETTING_SPECS[f.setting].default, f.default || "relecteur");
    assert.ok(SETTING_SPECS[f.setting].values.includes(SETTING_SPECS[f.setting].default));
    assert.ok(SETTING_SPECS[f.setting].values.includes("aucun"));
    assert.equal(SETTING_HELP[f.setting].section, "feat");
  }
});

/* M3-91 : le relecteur ne voit pas le SEO, même sur une base où le réglage n'a
   jamais été enregistré. */
test("SEO et rattachement : fermés au relecteur par défaut, ouverts au-dessus", () => {
  assert.equal(featsFor("relecteur", {}).seoLocal, false);
  assert.equal(featsFor("super_utilisateur", {}).seoLocal, true);
  assert.equal(featsFor("relecteur", { feat_seo_local_min_role: "relecteur" }).seoLocal, true);
});

/* M3-97 : les purgés de l'Historique, réservés au super utilisateur et à
   l'administrateur, même sur une base qui n'a jamais enregistré le réglage. */
test("purgés dans l'Historique : fermés au relecteur par défaut, ouverts au-dessus", () => {
  assert.equal(featsFor("relecteur", {}).historiquePurges, false);
  assert.equal(featsFor("super_utilisateur", {}).historiquePurges, true);
  assert.equal(featsFor("administrateur", {}).historiquePurges, true);
  assert.equal(featsFor("relecteur", { feat_historique_purges_min_role: "relecteur" }).historiquePurges, true);
  assert.equal(featsFor("super_utilisateur", { feat_historique_purges_min_role: "administrateur" }).historiquePurges, false);
});

/* M3-93 : la FEAT est le droit de publier sans image. */
test("illustration obligatoire : sous le seuil seulement, et une URL vide ne compte pas", () => {
  const sans = { illustration: null }, vide = { illustration: { url: "  ", credit: "" } }, avec = { illustration: { url: "https://x/i.jpg" } };
  assert.equal(illustrationMissing(sans, "relecteur", {}), false, "défaut : personne n'y est obligé");
  const s = { feat_sans_illustration_min_role: "super_utilisateur" };
  assert.equal(illustrationMissing(sans, "relecteur", s), true);
  assert.equal(illustrationMissing(vide, "relecteur", s), true);
  assert.equal(illustrationMissing(avec, "relecteur", s), false);
  assert.equal(illustrationMissing(sans, "super_utilisateur", s), false);
  assert.equal(illustrationMissing(sans, "administrateur", { feat_sans_illustration_min_role: "aucun" }), true);
  assert.equal(hasImage(vide), false);
  // la console applique la même règle à partir de featsFor
  assert.equal(illustrationBlocked(sans, featsFor("relecteur", s)), true);
  assert.equal(illustrationBlocked(avec, featsFor("relecteur", s)), false);
  assert.equal(illustrationBlocked(sans, {}), false, "FEAT inconnue : rien de bloqué");
});

/* Le critère de conformité suit la même règle que la FEAT : une case
   d'illustration sans URL n'est plus « Fournie ». */
test("critère Illustration : une URL, pas une case vide", () => {
  assert.equal(analyze({ illustration: { url: "", credit: "©" } }).illoOK, false);
  assert.equal(analyze({ illustration: {} }).illoOK, false);
  assert.equal(analyze({ illustration: null }).illoOK, false);
  /* M3-113 (décision 6) : le critère exige aussi le crédit. */
  assert.equal(analyze({ illustration: { url: "https://x/i.jpg", credit: "© M3" } }).illoOK, true);
});

test("rôle minimal : en dessous fermé, au-dessus ouvert", () => {
  assert.equal(featOpen("relecteur", "super_utilisateur"), false);
  assert.equal(featOpen("super_utilisateur", "super_utilisateur"), true);
  assert.equal(featOpen("administrateur", "relecteur"), true);
});

test("« aucun » ferme la FEAT à tous, administrateur compris", () => {
  // roleAtLeast seul l'aurait ouverte : un seuil inconnu y vaut 0
  assert.equal(featOpen("administrateur", "aucun"), false);
});

test("featsFor : une entrée par FEAT, réglages absents = défaut de la FEAT", () => {
  const base = { dark: true, antiPlagiat: true, seoLocal: false, demandeSource: true, sansIllustration: true, alerteModeleDefaut: false, historiquePurges: false, coutRoutines: false, notifConcurrents: false };
  assert.deepEqual(featsFor("relecteur", {}), base);
  assert.deepEqual(featsFor("relecteur", { feat_dark_min_role: "administrateur" }), { ...base, dark: false });
});
