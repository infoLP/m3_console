/* Scoring éditorial / SEO / conformité — partagé backend + navigateur.
   Porté depuis console-redaction-editable.html (analyze / rankBand / wordsOf…).
   Aucune dépendance DOM. */

import { DEFAULT_SETTINGS, H2_REQUIRED_ABOVE_SIGNS, asBlocks, outlineOf, hasImage, hasCredit } from "./model.js";
import { slugRuleOk } from "./slug.js";

/* Début de la bande « Fort alignement » du ranking (M3-113, décision 2). Une seule
   valeur, lue par rankBand ET par le barème du prompt (src/llm/prompts/generate.js,
   tranche haute) : jusqu'au 2026-10-15, la grille disait 75 et le barème 80. */
export const SEUIL_FORT_ALIGNEMENT = 80;

/* Réglages actifs : le backend passe toujours un objet explicite ; le navigateur
   appelle setScoringSettings() après /api/me pour aligner front et back. */
let ACTIVE = { ...DEFAULT_SETTINGS };
export function setScoringSettings(s) {
  ACTIVE = { ...DEFAULT_SETTINGS, ...(s || {}) };
}
export function scoringSettings() { return ACTIVE; }

export function nf(n) {
  return Number(n).toLocaleString("fr-FR");
}

/* Longueur du corps en signes (espaces normalisés). Les intertitres comptent :
   ils font partie de ce qui est lu, et les exclure ferait varier le nombre de
   signes au seul fait de structurer un texte inchangé. */
export function wordsOf(a) {
  return asBlocks(a.body).map((b) => b.text).join(" ")
    .replace(/\s+/g, " ")
    .trim().length;
}

export function readingOf(a, settings = ACTIVE) {
  const spm = settings.signs_per_minute || 1400;
  return Math.max(1, Math.round(wordsOf(a) / spm));
}

/* Décompte du plan Hn. Un intertitre au libellé vide ne compte pas : la barre SEO
   crée les lignes vides à l'ajout, les valider reviendrait à noter une case vide. */
export function outlineStats(outline) {
  const rows = (Array.isArray(outline) ? outline : [])
    .filter((o) => o && String(o.x || "").trim().length > 0);
  return {
    h1: rows.filter((o) => o.t === "H1").length,
    h2: rows.filter((o) => o.t === "H2").length,
    h3: rows.filter((o) => o.t === "H3").length,
    total: rows.length,
  };
}

/* Attendu figé à la génération pour une règle (M3-113, contrat `checks.rules.checked`) :
   l'élément de clé `cle`, ou null pour un article ancien, qui prend alors les
   Paramètres actuels. */
export function attenduDe(article, cle) {
  const list = article && article.checks && article.checks.rules && article.checks.rules.checked;
  const e = Array.isArray(list) ? list.find((x) => x && x.cle === cle) : null;
  return (e && e.attendu) || null;
}
const borne = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/* SEO complet : titre ≤ N, méta-description dans [min,max], slug conforme,
   ≥ K mots-clés, et un plan Hn tenable — exactement un H1, au moins N H2.
   Le plan était jusqu'au 2026-09-17 saisissable mais jamais relu (cf. TODO).

   Prend l'ARTICLE et non son seul bloc `seo` : le plan Hn se lit maintenant dans
   le corps, et le H1 est le titre. Les trois appelants (analyze, render, refresh)
   ont été repris en conséquence. */
export function seoComplete(article, settings = ACTIVE) {
  const s = (article && article.seo) || {};
  const mt = String(s.metaTitle || "");
  const md = String(s.metaDescription || "");
  /* M3-113 (décision 4) : la grille juge sur l'attendu de la génération
     (checks.rules.checked), comme la longueur sur checks.length. La fenêtre de la
     balise titre et de la méta-description n'était pas lue : une balise de 20
     caractères passait sous une fenêtre 30–60. Sans attendu, les Paramètres. */
  const attMt = attenduDe(article, "balise_titre") || {};
  const attMd = attenduDe(article, "meta") || {};
  const attSlug = attenduDe(article, "slug") || {};
  const attKw = attenduDe(article, "mots_cles") || {};
  /* Plancher : seulement celui de la fenêtre figée à la génération. Sans elle
     (article ancien, ou title_source_pct = 0), la règle n'a pas de minimum —
     meta_title_min ne vaut que pour une fenêtre, que la grille ne sait pas
     recalculer sans le titre de la source. */
  const mtMin = borne(attMt.min) ?? 0;
  const mtMax = borne(attMt.max) ?? (settings.meta_title_max || 60);
  const mdMin = borne(attMd.min) ?? (settings.meta_desc_min || 70);
  const mdMax = borne(attMd.max) ?? (settings.meta_desc_max || 160);
  const mtOK = mt.length > 0 && mt.length >= mtMin && mt.length <= mtMax;
  const mdOK = md.length >= mdMin && md.length <= mdMax;
  /* Slug : la règle de la génération (shared/slug.js), et plus seulement le
     format — un slug de 9 mots, ou avec « de », passait la grille. */
  /* Article qui a un `checked` : son attendu fait foi, même sans `max` (0 =
     sans limite). Les Paramètres du jour ne valent que pour un article ancien. */
  const fige = Array.isArray(article?.checks?.rules?.checked);
  const slugMaxWords = fige ? (borne(attSlug.max) ?? 0) : settings.slug_max_words;
  const slugOK = slugRuleOk(String(s.slug || ""), { slug_max_words: slugMaxWords });
  /* Mots-clés non vides seulement, comme checkRules : la barre SEO crée des
     lignes vides à l'ajout. */
  const kwCount = Array.isArray(s.keywords) ? s.keywords.filter((k) => String(k ?? "").trim().length > 0).length : 0;
  const kwMin = borne(attKw.min) ?? (settings.keywords_min || 3);
  const kwOK = kwCount >= kwMin;
  const ol = outlineStats(outlineOf(article));
  /* Le minimum de H2 ne vaut que pour un article long : une brève n'a pas
     d'intertitre, et le prompt le lui interdit presque (réglage h2_above_signs,
     le même que cite le prompt). Le H1 unique, lui, reste exigé partout.
     Décidé le 2026-10-12. */
  /* Seuil et minimum figés à la génération (attendu `plan_hn`) quand l'article
     en a un ; sinon les Paramètres actuels (M3-113, relecture). */
  const attPlan = fige ? attenduDe(article, "plan_hn") : null;
  const seuilH2 = borne(attPlan?.seuil) ?? (settings.h2_above_signs || H2_REQUIRED_ABOVE_SIGNS);
  const minH2 = attPlan ? (borne(attPlan.min) ?? 0) : settings.outline_h2_min == null ? 1 : settings.outline_h2_min;
  const long = wordsOf(article || {}) > seuilH2;
  const h2Min = !long ? 0 : minH2;
  const olOK = ol.h1 === 1 && ol.h2 >= h2Min;
  return {
    mtOK, mdOK, slugOK, kwOK, olOK, outline: ol, h2Min,
    mtMin, mtMax, mdMin, mdMax, kwMin, kwCount,
    ok: mtOK && mdOK && slugOK && kwOK && olOK,
  };
}

/* Compteur du panneau « Structure Hn », dans le style de celui des mots-clés :
   l'état d'abord, l'exigence seulement quand elle n'est pas tenue. */
export function olCountLabel(seoDetail) {
  const ol = seoDetail.outline || { h1: 0, h2: 0 };
  const base = `${ol.h1} H1 · ${ol.h2} H2`;
  if (seoDetail.olOK) return base;
  /* Formulé en « attendu » et non en « min » : le défaut le plus courant est
     d'avoir DEUX H1, où un minimum ne veut rien dire. */
  return `${base} · attendu 1 H1, ≥ ${seoDetail.h2Min} H2`;
}

/* Détail affiché sur la ligne « SEO complet » du contrôle de conformité. Nomme ce
   qui manque plutôt que d'énumérer les champs : la ligne était figée sur « Méta,
   slug et mots-clés », ce qui a masqué pendant des semaines l'absence du plan Hn.
   Partagé par render.js et refresh.js, qui construisent tous deux la liste. */
export function seoRowDetail(detail) {
  const missing = [];
  if (!detail.mtOK) missing.push("balise titre");
  if (!detail.mdOK) missing.push("méta-description");
  if (!detail.slugOK) missing.push("slug");
  if (!detail.kwOK) missing.push("mots-clés");
  if (!detail.olOK) missing.push("structure Hn");
  return missing.length
    ? "Manque : " + missing.join(", ")
    : "Méta, slug, mots-clés et structure Hn";
}

/* Contrôle de conformité — 5 critères, 1 point chacun (preREADME §Scoring). */
export function analyze(a, settings = ACTIVE) {
  const w = wordsOf(a);
  /* M3-86 : la fenêtre calculée à la génération (checks.length) est celle que le
     prompt a citée ; la grille juge sur la même. Sans elle (article ancien, règle
     désactivée), les bornes de la génération : breve_signs_min à signs_max
     (M3-113, décision 1 : signs_min, lu par la seule grille, est supprimé). */
  const cible = a.checks && a.checks.length;
  const fenetre = cible && Number(cible.min) > 0 && Number(cible.max) >= Number(cible.min);
  const lengthMin = fenetre ? Number(cible.min) : (settings.breve_signs_min || DEFAULT_SETTINGS.breve_signs_min);
  const lengthMax = fenetre ? Number(cible.max) : (settings.signs_max || DEFAULT_SETTINGS.signs_max);
  const lengthOK = w >= lengthMin && w <= lengthMax;
  const rankOK = Number(a.ranking) >= (settings.ranking_threshold || 60);
  const sourceOK = !!(a.source && a.source.type && a.source.type !== "none" && a.source.url);
  /* Une URL, pas une case vide (M3-93), ET un crédit (M3-113, décision 6). */
  const illoImage = hasImage(a), illoCredit = hasCredit(a);
  const illoOK = illoImage && illoCredit;
  const seo = seoComplete(a, settings);
  const passed = [lengthOK, rankOK, sourceOK, illoOK, seo.ok].filter(Boolean).length;
  return {
    words: w,
    lengthOK, lengthMin, lengthMax, lengthCible: fenetre ? Number(cible.target) || null : null,
    rankOK, sourceOK, illoOK, illoImage, illoCredit,
    seoOK: seo.ok, seoDetail: seo,
    passed, total: 5, ready: passed === 5,
  };
}

/* Les cinq critères du cahier des charges, dans leur ordre d'affichage. */
export const CRITERIA = [
  ["longueur", "Longueur"], ["ranking", "Alignement éditorial"], ["source", "Source citée"],
  ["illustration", "Illustration"], ["seo", "SEO complet"],
];

/* M3-72 : libellés des critères non remplis — vide si l'article peut paraître.
   Une seule règle pour la console, les actions serveur et le planificateur
   (publishDue, en JS pur : il ne peut pas lire le TypeScript de la console).
   L'illustration suit la FEAT « Parution sans illustration » (M3-93) : le
   rôle qui en a le droit n'est pas bloqué sur ce critère. */
export function missingCriteria(a, settings, { sansIllustration = false } = {}) {
  const A = analyze(a, { ...DEFAULT_SETTINGS, ...(settings || {}) });
  const ok = { longueur: A.lengthOK, ranking: A.rankOK, source: A.sourceOK, illustration: A.illoOK || !!sansIllustration, seo: A.seoOK };
  return CRITERIA.filter(([k]) => !ok[k]).map(([, label]) => label);
}

export function rankBand(r, settings = ACTIVE) {
  const thr = settings.ranking_threshold || 60;
  if (r >= SEUIL_FORT_ALIGNEMENT) return { lab: "Fort alignement", key: "fort", c: "var(--go)", bg: "var(--go-tint)" };
  /* Au-dessus du seuil de parution : conforme, donc plus en orange (M3-113). */
  if (r >= thr) return { lab: "Aligné", key: "aligne", c: "var(--go)", bg: "var(--go-tint)" };
  return { lab: "Sous le seuil", key: "sous", c: "var(--stop)", bg: "var(--stop-tint)" };
}

export function meterCls(len, min, max) {
  const over = len > max;
  const warn = !over && (len > max - 8 || (min && len < min));
  return over ? "cr-count over" : warn ? "cr-count warn" : "cr-count";
}

/* Résumé compact des trois indicateurs distincts (preREADME : éditorial / SEO / conformité). */
/* Recalcul pur des scores stockés (M3-113, décision 4), pour la migration de
   recalcul : `article.scores` tel que l'écrivent la génération et l'édition, avec
   les Paramètres complétés par les défauts. Ne modifie pas l'article. */
export function recalculerScores(article, settings) {
  const a = article || {};
  const scores = scoreSummary(a, { ...DEFAULT_SETTINGS, ...(settings || {}) });
  /* Sans `ranking` dans le document, scoreSummary noterait 0 : la note
     éditoriale déjà stockée est conservée, jamais remise à zéro (relecture 5). */
  const sansRanking = a.ranking == null || a.ranking === "" || !Number.isFinite(Number(a.ranking));
  if (sansRanking && a.scores && a.scores.editorial != null) {
    scores.editorial = a.scores.editorial;
    if (a.scores.editorialBand != null) scores.editorialBand = a.scores.editorialBand;
  }
  return scores;
}

export function scoreSummary(a, settings = ACTIVE) {
  const A = analyze(a, settings);
  return {
    editorial: Number(a.ranking) || 0,
    editorialBand: rankBand(Number(a.ranking) || 0, settings).key,
    seo: A.seoOK ? "conforme" : "a_revoir",
    conformity: { passed: A.passed, total: A.total, detail: {
      longueur: A.lengthOK, ranking: A.rankOK, source: A.sourceOK,
      illustration: A.illoOK, seo: A.seoOK,
    } },
    ready: A.ready,
  };
}
