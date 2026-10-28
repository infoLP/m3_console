/* Règle du slug (M3-56), UNE définition : lue par finalize (qui refait le
   slug), par checkRules (qui le contrôle) et par la grille (shared/scoring.js).
   Sortie de src/llm/rules.js (M3-113) : rules.js importe scoring.js, l'inverse
   aurait été circulaire. Module pur, sans import : utilisable côté navigateur.
   Mots vides comparés sans accent. */

/* 6 mots au plus (décision du 2026-10-15). 0 = sans limite ; les mots vides et
   les dates, eux, sont toujours écartés. */
export const SLUG_MAX_WORDS = 6;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const STOP_WORDS = new Set([
  "le", "la", "les", "l", "de", "du", "des", "d", "un", "une", "a", "au", "aux",
  "et", "en", "pour", "sur", "dans", "par", "avec", "ou", "ce", "ces", "cette",
  "qu", "que", "qui", "se", "s", "son", "sa", "ses",
]);
const MONTHS = new Set(["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"]);
const WEEKDAYS = new Set(["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]);
const isNum = (t) => /^\d+$/.test(t);
const isYear = (t) => /^\d{4}$/.test(t);

/* Mots du texte, sans accent, en minuscules (apostrophes = séparateurs :
   « l'école » → l, ecole, puis « l » tombe avec les mots vides). */
function slugTokens(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean);
}

/* Index des mots qui font partie d'une date : année à 4 chiffres ; mois ou
   jour de la semaine collé à un nombre (« 14 octobre », « octobre 2026 »,
   « lundi 14 ») avec ce nombre. Un nombre isolé (« 2 millions ») reste. */
function dateIdx(tokens) {
  const drop = new Set();
  tokens.forEach((t, i) => {
    if (isYear(t)) drop.add(i);
    const name = MONTHS.has(t) || WEEKDAYS.has(t);
    if (!name) return;
    const prev = tokens[i - 1], next = tokens[i + 1];
    if (next !== undefined && isNum(next)) { drop.add(i); drop.add(i + 1); }
    if (prev !== undefined && isNum(prev) && MONTHS.has(t)) { drop.add(i); drop.add(i - 1); }
  });
  return drop;
}

/* Plafond de mots lu dans les réglages (`slug_max_words`), défaut sinon. */
export const slugMaxWords = (rules) => {
  const v = Number(rules && rules.slug_max_words);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : SLUG_MAX_WORDS;
};

/* Slug d'un texte : minuscules, sans accent, tirets, sans mot vide ni date, au
   plus slug_max_words mots (0 = sans limite). « article » si rien ne reste. */
export function slugify(text, rules = {}) {
  const tokens = slugTokens(text);
  const drop = dateIdx(tokens);
  let words = tokens.filter((t, i) => !drop.has(i) && !STOP_WORDS.has(t));
  const max = slugMaxWords(rules);
  if (max > 0) words = words.slice(0, max);
  return words.join("-") || "article";
}

/* Le slug tient-il la règle ? Format, nombre de mots, mots vides, dates. */
export function slugRuleOk(slug, rules = {}) {
  const s = String(slug || "");
  if (!SLUG_RE.test(s)) return false;
  const tokens = s.split("-");
  const max = slugMaxWords(rules);
  if (max > 0 && tokens.length > max) return false;
  if (tokens.some((t) => STOP_WORDS.has(t))) return false;
  return dateIdx(tokens).size === 0;
}

/* Raison lisible d'un slug refusé, pour la liste des écarts. */
export function slugRuleDetail(slug, rules = {}) {
  const s = String(slug || "");
  if (!SLUG_RE.test(s)) return "slug hors format (minuscules, chiffres et tirets, sans accent)";
  const tokens = s.split("-");
  const max = slugMaxWords(rules);
  if (max > 0 && tokens.length > max) return `slug de ${tokens.length} mots, ${max} au plus`;
  if (tokens.some((t) => STOP_WORDS.has(t))) return "slug avec un mot vide (le, de, à…)";
  return "slug avec une date";
}
