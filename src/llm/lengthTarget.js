/* Longueur visée d'un article (M3-86, weekly 2026-10-13).

   La longueur dépend de la matière de la source :
   - source trop petite  → le minimum fixe (`breve_signs_min`) ;
   - entre les deux      → un pourcentage de la source (`length_source_pct`) ;
   - source trop grande  → le maximum fixe (`signs_max`).

   cible = borne(pourcentage × signes de la source, minimum, maximum)

   UNE seule fonction calcule cette cible, et tous les lecteurs l'appellent : le
   prompt de génération (src/llm/prompts/generate.js) la cite, le contrôle après
   génération (src/llm/rulesCheck.js, M3-87) la vérifie, et l'article la garde
   dans `checks.length` pour que la grille puisse la relire. Le désaccord du
   2026-10-12 — le prompt demandait ce que la grille refusait — venait de deux
   calculs de la même règle.

   Module pur : ni base, ni réseau, importable par le serveur comme par les
   tests. Les valeurs par défaut vivent dans shared/model.js (T18, lot 2) :
   le registre des réglages (src/lib/yamlStore.js) et la console les y lisent. */

import { LENGTH_DEFAULTS } from "../../shared/model.js";

export { LENGTH_DEFAULTS };

/* Marge autour de la cible : une consigne « 1 000 signes pile » est intenable
   pour un modèle, et un contrôle au signe près rejetterait tout. ±20 %, toujours
   tenue dans [minimum, maximum]. Constante et non réglage : elle ne change pas
   la cible, seulement la tolérance du contrôle — on l'exposera si le besoin
   s'en fait sentir, pas avant. */
export const LENGTH_TOLERANCE = 0.2;

const toNum = (v) => (v === "" || v == null ? NaN : Number(v));
const round10 = (n) => Math.round(n / 10) * 10;

/* `rules` : les réglages (défauts compris). `sourceSigns` : signes utiles de la
   source (`sourceSignsOf`, src/generate/quality.js).
   → null si la règle est désactivée ou la source inconnue : l'appelant revient
   alors à la consigne d'avant, sans cible. */
export function lengthTarget(rules = {}, sourceSigns) {
  const pctRaw = toNum(rules.length_source_pct);
  const pct = Number.isFinite(pctRaw) ? pctRaw : LENGTH_DEFAULTS.length_source_pct;
  const n = toNum(sourceSigns);
  if (!(pct > 0) || !(n > 0)) return null;

  const min = toNum(rules.breve_signs_min);
  const max = toNum(rules.signs_max);
  if (!(min > 0) || !(max >= min)) return null;

  const raw = (n * pct) / 100;
  const bound = raw < min ? "min" : raw > max ? "max" : "pct";
  const target = Math.min(max, Math.max(min, round10(raw)));
  return {
    sourceSigns: Math.round(n),
    pct,
    target,
    /* Fenêtre acceptée par le contrôle et citée par le prompt. */
    min: Math.max(min, round10(target * (1 - LENGTH_TOLERANCE))),
    max: Math.min(max, round10(target * (1 + LENGTH_TOLERANCE))),
    bound,
  };
}

/* La longueur tient-elle dans la fenêtre ? `signs` se mesure comme la grille
   (wordsOf, shared/scoring.js) : texte des blocs, espaces normalisées. */
export function withinTarget(target, signs) {
  if (!target) return true;
  return signs >= target.min && signs <= target.max;
}

/* --- titres et méta-description (M3-86) ---------------------------------- */

const round1 = (n) => Math.round(n);

/* Cible d'un champ : pct × mesure de la source, bornée [minimum, maximum], à
   l'unité ; fenêtre ±LENGTH_TOLERANCE tenue dans les mêmes bornes. null = règle
   désactivée (pct 0), mesure absente ou bornes incohérentes : l'appelant garde
   la règle d'avant. */
function oneFieldTarget(pctRaw, sourceChars, minRaw, maxRaw) {
  const p = toNum(pctRaw);
  const pct = Number.isFinite(p) ? p : 0;
  const n = toNum(sourceChars);
  const min = toNum(minRaw);
  const max = toNum(maxRaw);
  if (!(pct > 0) || !(n > 0) || !(min > 0) || !(max >= min)) return null;
  const raw = (n * pct) / 100;
  const bound = raw < min ? "min" : raw > max ? "max" : "pct";
  const target = Math.min(max, Math.max(min, round1(raw)));
  return {
    target,
    min: Math.max(min, round1(target * (1 - LENGTH_TOLERANCE))),
    max: Math.min(max, round1(target * (1 + LENGTH_TOLERANCE))),
    bound,
    pct,
    sourceChars: Math.round(n),
  };
}

/* Cibles des trois champs courts. `sourceTitleChars` : caractères du titre de
   la source ; `sourceLeadChars` : caractères de son chapô / premier paragraphe
   (`sourceFieldMeasuresOf`, src/generate/quality.js). Chaque champ est null ou
   { target, min, max, bound, pct, sourceChars }. */
export function fieldTargets(rules = {}, { sourceTitleChars, sourceLeadChars } = {}) {
  const r = { ...LENGTH_DEFAULTS, ...rules };
  return {
    title: oneFieldTarget(r.title_source_pct, sourceTitleChars, r.title_min, r.title_max),
    metaTitle: oneFieldTarget(r.title_source_pct, sourceTitleChars, r.meta_title_min, r.meta_title_max),
    metaDesc: oneFieldTarget(r.meta_source_pct, sourceLeadChars, r.meta_desc_min, r.meta_desc_max),
  };
}

/* Un champ tient-il dans sa fenêtre ? Sans cible, vrai : le contrôle fixe reste
   celui de checkRules. */
export const withinField = (t, chars) => !t || (chars >= t.min && chars <= t.max);

/* Fragment de consigne pour le prompt. `field` : "title" | "metaTitle" |
   "metaDesc". Sans cible : EXACTEMENT le texte que le prompt portait avant. */
export function fieldRule(field, rules = {}, t = null) {
  const r = { ...LENGTH_DEFAULTS, ...rules };
  if (!t) {
    if (field === "title") return `≤ ${r.title_max} caractères`;
    if (field === "metaTitle") return `≤ ${r.meta_title_max} caractères`;
    return `entre ${r.meta_desc_min} et ${r.meta_desc_max} caractères`;
  }
  const what = field === "metaDesc" ? "du chapô de la source" : "du titre de la source";
  const why = t.bound === "min" ? `le minimum fixé, ${field === "metaDesc" ? "le chapô" : "le titre"} de la source étant court (${t.sourceChars} caractères)`
    : t.bound === "max" ? `le maximum fixé, ${field === "metaDesc" ? "le chapô" : "le titre"} de la source étant long (${t.sourceChars} caractères)`
      : `${t.pct} % ${what} (${t.sourceChars} caractères)`;
  return `environ ${t.target} caractères, jamais moins de ${t.min} ni plus de ${t.max} — ${why}`;
}
