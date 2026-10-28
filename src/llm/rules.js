/* Règles chiffrées de la génération : celles que cite le prompt
   (src/llm/prompts/generate.js) et que vérifie le contrôle après génération
   (M3-87). Un seul module pour les deux, pour qu'ils ne puissent pas lire deux
   valeurs différentes d'une même règle. Module pur : ni base, ni réseau. */

import { DEFAULT_SETTINGS, PROMPT_DEFAULTS, RULES_DEFAULTS, asBlocks } from "../../shared/model.js";
import { wordsOf } from "../../shared/scoring.js";
import { LENGTH_DEFAULTS, withinTarget, withinField } from "./lengthTarget.js";
import { SLUG_MAX_WORDS, slugMaxWords, slugify, slugRuleOk, slugRuleDetail } from "../../shared/slug.js";

/* La définition du slug vit dans shared/slug.js (M3-113) : réexportée ici pour
   les appelants d'avant. */
export { slugify, slugRuleOk, slugRuleDetail };

/* Valeurs par défaut dans shared/model.js (T18, lot 2), lues aussi par la console. */
export { RULES_DEFAULTS } from "../../shared/model.js";

/* Réglages complétés par les défauts. Sans réglages, les défauts redonnent à
   l'octet près le texte reçu par les modèles avant le 2026-10-12. */
export function rulesOf(settings) {
  return { ...DEFAULT_SETTINGS, ...PROMPT_DEFAULTS, ...LENGTH_DEFAULTS, ...RULES_DEFAULTS, ...(settings || {}) };
}

/* Règles dont l'article garde la preuve dans `checks.rules.checked` (M3-113),
   dans l'ordre de lecture. Les huit premières sont mesurées par checkRules ;
   attribution, citations, lieux et rubrique par finalize, qui a la source. */
export const REGLES_CONTROLEES = Object.freeze([
  { cle: "titre", libelle: "Titre" },
  { cle: "intertitre", libelle: "Intertitres" },
  { cle: "h1", libelle: "Un seul H1" },
  { cle: "balise_titre", libelle: "Balise titre" },
  { cle: "meta", libelle: "Méta-description" },
  { cle: "mots_cles", libelle: "Mots-clés" },
  { cle: "slug", libelle: "Slug" },
  { cle: "plan_hn", libelle: "Plan Hn" },
  { cle: "attribution", libelle: "Attribution" },
  { cle: "citations", libelle: "Citations exactes" },
  { cle: "lieux", libelle: "Lieux de la source" },
  { cle: "rubrique", libelle: "Rubrique" },
].map((r) => Object.freeze(r)));

/* Consigne du prompt (insérée par src/llm/prompts/generate.js). */
export function slugRule(rules = {}) {
  const max = slugMaxWords(rules);
  const n = max > 0 ? `${max} mot${max > 1 ? "s" : ""} au plus, ` : "";
  return `Slug : ${n}en minuscules, séparés par des tirets, sans accent, sans mot vide (le, de, à…) ni date.`;
}
const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const len = (s) => String(s || "").trim().length;

const car = (n) => `${nf(n)} caractère${n > 1 ? "s" : ""}`;
const borne = (min, max) => (min !== undefined && min !== null
  ? { min, max, texte: `${nf(min)}–${nf(max)} caractères` }
  : { max, texte: `≤ ${car(max)}` });

/* Contrôle après génération (M3-87) : chaque règle réglée dans les Paramètres
   et citée par le prompt, vérifiée sur la réponse. Rend
   - `violations` : les règles non tenues, vide si tout passe ;
   - `checked` (M3-113) : TOUTES les évaluations, tenues ou non, au format de
     `checks.rules.checked` — l'attendu figé à la génération et l'obtenu.

   `retry: false` marque ce que src/generate/finalize.js corrige seul, sans
   modèle (balise titre raccourcie, slug refait) : redemander un article entier
   pour cela se paierait sans rien apporter. Ces écarts restent listés — le
   contrôle final, après finalize, doit les voir disparaître.

   `target` : cible de longueur du corps (lengthTarget). `fields` : cibles du
   titre, de la balise titre et de la méta-description (fieldTargets, M3-86) ;
   null, ou un champ null = la règle d'avant (≤ max, ou [min, max] fixes).
   La longueur du corps n'est pas dans `checked` : sa preuve est checks.length. */
export function evaluateRules(gen, settings, target = null, fields = null) {
  const r = rulesOf(settings);
  const out = [];
  const checked = [];
  const add = (rule, detail, retry = true) => out.push({ rule, detail, retry });
  const mesure = (cle, attendu, obtenu, ok, retry, motif) =>
    checked.push({ cle, attendu, obtenu, ok, ...(motif ? { motif } : {}), retry });
  const g = gen || {};
  const seo = g.seo || {};

  /* --- titres --- */
  const tl = len(g.title);
  const F = fields || {};
  if (!tl) add("title", "titre vide");
  else if (F.title) {
    if (!withinField(F.title, tl)) add("title", `titre de ${tl} caractères, attendu entre ${F.title.min} et ${F.title.max}`);
  } else if (tl > r.title_max) add("title", `titre de ${tl} caractères, ${r.title_max} au plus`);
  mesure("titre", F.title ? borne(F.title.min, F.title.max) : borne(null, r.title_max),
    { valeur: tl, texte: tl ? car(tl) : "titre vide" },
    !!tl && (F.title ? withinField(F.title, tl) : tl <= r.title_max), true);

  const blocks = asBlocks(g.body);
  /* Sur le corps BRUT : asBlocks ramène un type inconnu, h1 compris, à « p ». */
  const h1 = (Array.isArray(g.body) ? g.body : []).filter((b) => b && b.type === "h1").length;
  if (h1) add("h1", "intertitre de niveau h1 : le titre est le seul H1");
  mesure("h1", { max: 0, texte: "aucun H1 dans le corps : le titre est le seul" },
    { valeur: h1, texte: h1 ? `${h1} H1 dans le corps` : "aucun H1 dans le corps" }, h1 === 0, true);
  let plusLong = 0;
  for (const b of blocks) {
    if (b.type !== "h2" && b.type !== "h3") continue;
    plusLong = Math.max(plusLong, len(b.text));
    if (len(b.text) > r.h2_title_max) {
      add("h2_title", `intertitre « ${String(b.text).trim().slice(0, 40)}… » de ${len(b.text)} caractères, ${r.h2_title_max} au plus`);
    }
  }
  const inter = blocks.some((b) => b.type === "h2" || b.type === "h3");
  mesure("intertitre", borne(null, r.h2_title_max),
    inter ? { valeur: plusLong, texte: `plus long : ${car(plusLong)}` } : { texte: "aucun intertitre" },
    inter ? plusLong <= r.h2_title_max : null, true, inter ? undefined : "aucun intertitre à mesurer");

  /* --- longueur : la cible du prompt (M3-86) si elle existe, sinon les bornes fixes --- */
  const signs = wordsOf(g);
  if (target) {
    if (!withinTarget(target, signs)) add("length", `corps de ${nf(signs)} signes, attendu entre ${nf(target.min)} et ${nf(target.max)}`);
  } else if (signs < r.breve_signs_min || signs > r.signs_max) {
    add("length", `corps de ${nf(signs)} signes, attendu entre ${nf(r.breve_signs_min)} et ${nf(r.signs_max)}`);
  }

  /* --- structure : le seuil et le minimum mêmes que ceux de la grille --- */
  const h2 = blocks.filter((b) => b.type === "h2").length;
  const h2Exige = r.outline_h2_min > 0 && signs > r.h2_above_signs;
  if (h2Exige && h2 < r.outline_h2_min) {
    add("h2_count", `${h2} intertitre(s) h2 pour ${nf(signs)} signes, ${r.outline_h2_min} au moins au-delà de ${nf(r.h2_above_signs)}`);
  }
  mesure("plan_hn",
    r.outline_h2_min > 0
      /* `seuil` stocké aussi : la grille juge sur l'attendu figé, pas sur les
         Paramètres du jour (M3-113, relecture). */
      ? { min: r.outline_h2_min, seuil: r.h2_above_signs, texte: `1 H1 · ≥ ${r.outline_h2_min} H2 au-delà de ${nf(r.h2_above_signs)} signes` }
      : { min: 0, seuil: r.h2_above_signs, texte: "1 H1 · H2 facultatifs" },
    { valeur: h2, texte: `${h1 ? h1 + 1 : 1} H1 · ${h2} H2 pour ${nf(signs)} signes` },
    h1 === 0 && (!h2Exige || h2 >= r.outline_h2_min), true);

  /* --- SEO --- */
  const mt = len(seo.metaTitle);
  if (!mt) add("meta_title", "balise titre vide", false);
  else if (F.metaTitle) {
    /* Trop longue : finalize la raccourcit seul. Trop courte : il ne sait pas
       l'allonger, c'est au modèle de le faire. */
    if (mt > F.metaTitle.max) add("meta_title", `balise titre de ${mt} caractères, attendu entre ${F.metaTitle.min} et ${F.metaTitle.max}`, false);
    else if (mt < F.metaTitle.min) add("meta_title", `balise titre de ${mt} caractères, attendu entre ${F.metaTitle.min} et ${F.metaTitle.max}`);
  } else if (mt > r.meta_title_max) add("meta_title", `balise titre de ${mt} caractères, ${r.meta_title_max} au plus`, false);
  mesure("balise_titre", F.metaTitle ? borne(F.metaTitle.min, F.metaTitle.max) : borne(null, r.meta_title_max),
    { valeur: mt, texte: mt ? car(mt) : "balise titre vide" },
    !!mt && (F.metaTitle ? mt >= F.metaTitle.min && mt <= F.metaTitle.max : mt <= r.meta_title_max),
    !!(mt && F.metaTitle && mt < F.metaTitle.min));
  const md = len(seo.metaDescription);
  const mdLo = F.metaDesc ? F.metaDesc.min : r.meta_desc_min;
  const mdHi = F.metaDesc ? F.metaDesc.max : r.meta_desc_max;
  if (md < mdLo || md > mdHi) add("meta_description", `méta-description de ${md} caractères, attendu entre ${mdLo} et ${mdHi}`);
  mesure("meta", borne(mdLo, mdHi), { valeur: md, texte: md ? car(md) : "méta-description vide" }, md >= mdLo && md <= mdHi, true);
  const kw = Array.isArray(seo.keywords) ? seo.keywords.filter((k) => len(k)).length : 0;
  if (kw < r.keywords_min) add("keywords", `${kw} mot(s)-clé(s), ${r.keywords_min} au moins`);
  mesure("mots_cles", { min: r.keywords_min, texte: `≥ ${r.keywords_min} mot${r.keywords_min > 1 ? "s" : ""}-clé${r.keywords_min > 1 ? "s" : ""}` },
    { valeur: kw, texte: `${kw} mot${kw > 1 ? "s" : ""}-clé${kw > 1 ? "s" : ""}` }, kw >= r.keywords_min, true);
  const slugOk = slugRuleOk(seo.slug, r);
  if (!slugOk) add("slug", slugRuleDetail(seo.slug, r), false);
  const maxMots = slugMaxWords(r);
  const slug = String(seo.slug || "");
  const nMots = slug ? slug.split("-").filter(Boolean).length : 0;
  mesure("slug",
    /* max toujours stocké, 0 = sans limite : sans lui, la grille retomberait
       sur le réglage du jour (M3-113, relecture). */
    { max: maxMots > 0 ? maxMots : 0, texte: `${maxMots > 0 ? `≤ ${maxMots} mots, ` : ""}sans mot vide ni date` },
    { valeur: slug, texte: slug ? `${slug} (${nMots} mot${nMots > 1 ? "s" : ""})${slugOk ? "" : ` : ${slugRuleDetail(slug, r)}`}` : "slug vide" },
    slugOk, false);

  const ordre = REGLES_CONTROLEES.map((x) => x.cle);
  checked.sort((a, b) => ordre.indexOf(a.cle) - ordre.indexOf(b.cle));
  return { violations: out, checked };
}

/* Les seules règles non tenues : le retour d'avant M3-113, lu par
   enforceRules et par les relances. */
export function checkRules(gen, settings, target = null, fields = null) {
  return evaluateRules(gen, settings, target, fields).violations;
}

/* Écarts qui justifient une nouvelle demande au modèle. */
export const blocking = (violations) => (violations || []).filter((v) => v.retry !== false);

/* Ce qu'on renvoie au modèle quand sa réponse est rejetée : les règles
   manquées, nommément, puis sa réponse à corriger. Le prompt d'origine précède
   (voir `enforceRules`) : le modèle garde toutes les consignes. */
export function correctionPrompt(violations, previous) {
  const { lengthTarget: _t, ruleCheck: _c, ...prev } = previous || {};
  return `

CORRECTION OBLIGATOIRE — ta réponse précédente a été REJETÉE par le contrôle automatique,
car elle ne respecte pas ces règles :
${blocking(violations).map((v) => `- ${v.detail}`).join("\n")}
Réécris l'article COMPLET, au même format JSON, en respectant TOUTES les contraintes
ci-dessus, sans rien inventer. Ta réponse précédente, à corriger :
${JSON.stringify(prev)}`;
}

/* Génère, contrôle, et redemande tant qu'une règle n'est pas tenue (M3-87).

   - `produce(feedback)` : un appel au modèle ; `feedback` est null au premier,
     puis la consigne de correction à ajouter au prompt ;
   - `check(gen)` : la liste des règles non tenues (checkRules) ;
   - `maxRetries` : nouvelles demandes au plus (réglage rules_retry_max) ;
   - `canRetry()` : faux quand une relance n'est plus permise — plafond de
     dépense atteint (M3-62) : une relance se paie comme une génération.

   Garde la meilleure réponse (le moins d'écarts bloquants ; à égalité, la plus
   récente, qui a vu la correction). Une relance qui échoue (réseau, réponse
   illisible) ne fait pas perdre la réponse déjà payée : on s'arrête là. Seul
   un échec du PREMIER appel remonte, pour que l'appelant bascule de moteur. */
export async function enforceRules({ produce, check, maxRetries = 0, canRetry = async () => true }) {
  let best = await produce(null);
  let bestV = check(best);
  let attempts = 1;
  let stopped = null;
  while (blocking(bestV).length && attempts <= maxRetries) {
    if (!(await canRetry())) { stopped = "plafond"; break; }
    let g;
    attempts++;
    try { g = await produce(correctionPrompt(bestV, best)); }
    catch (err) { stopped = `relance en échec : ${err.message || err}`; break; }
    const v = check(g);
    if (blocking(v).length <= blocking(bestV).length) { best = g; bestV = v; }
  }
  return { gen: best, violations: bestV, attempts, stopped };
}
