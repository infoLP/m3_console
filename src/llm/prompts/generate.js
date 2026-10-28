import { lengthTarget, fieldTargets, fieldRule } from "../lengthTarget.js";
import { rulesOf, slugRule } from "../rules.js";
import { CAT } from "../../../shared/model.js";
import { SEUIL_FORT_ALIGNEMENT } from "../../../shared/scoring.js";
import { DEFAULT_TEMPLATE, FORMAT_SORTIE, renderTemplate } from "./template.js";

/* Toutes les contraintes chiffrées du prompt viennent des réglages (onglet
   Paramètres) : celles que la grille contrôle aussi (shared/scoring.js) y lisent
   la MÊME valeur, si bien que le prompt ne peut plus demander ce que la grille
   refuse — le désaccord du 2026-10-12. `rulesOf` (src/llm/rules.js) complète
   par les défauts, pour le prompt comme pour le contrôle après génération. */
export { rulesOf };

/* Consigne de longueur. Avec une cible (M3-86), le modèle reçoit la valeur que
   le contrôle après génération vérifiera — calculée par la même fonction. Sans
   cible (règle à 0 %, ou source inconnue : régénération d'un article ancien),
   la consigne d'avant, mot pour mot. */
function lengthRule(r, t) {
  if (!t) {
    return `- Longueur PROPORTIONNÉE à la matière réellement disponible — pas de quota, pas de
  remplissage. Si la source ne porte qu'une seule information, rédige une BRÈVE de
  ${fmt(r.breve_signs_min)} à ${fmt(r.h2_above_signs)} signes (1 à 2 paragraphes). Sinon, ${fmt(r.breve_signs_min)} à ${fmt(r.signs_max)} signes.`;
  }
  const why = t.bound === "min" ? "le minimum fixé, la source étant courte"
    : t.bound === "max" ? "le maximum fixé, la source étant longue"
      : `${t.pct} % de la matière utile de la source`;
  const breve = t.max <= r.h2_above_signs ? " C'est une BRÈVE : 1 à 2 paragraphes, sans intertitre." : "";
  return `- LONGUEUR IMPÉRATIVE du corps (intertitres compris, espaces comprises) : environ
  ${fmt(t.target)} signes, et JAMAIS moins de ${fmt(t.min)} ni plus de ${fmt(t.max)} signes —
  ${why} (${fmt(t.sourceSigns)} signes). N'invente rien pour atteindre la longueur :
  développe le contexte donné par la source, sans phrase creuse.${breve}`;
}

/* Les éléments extraits partent au modèle tels quels, moins les mesures de la
   source (corps, titre, chapô) : ce sont des données pour le code, pas des
   informations à rédiger. */
const MEASURES = ["source_signs", "source_title_chars", "source_lead_chars"];
function forModel(extracted) {
  if (!extracted || typeof extracted !== "object" || !MEASURES.some((k) => k in extracted)) return extracted;
  return Object.fromEntries(Object.entries(extracted).filter(([k]) => !MEASURES.includes(k)));
}

/* Milliers séparés par une espace simple, comme le texte que les modèles ont
   reçu jusqu'ici (« 1 500 », « 7 000 »). */
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/* Le plafond de la brève et le seuil du H2 sont la même frontière. Le nombre de
   H2 suit outline_h2_min : à 0, la grille ne les exige plus, le prompt non plus. */
function h2Rule(r) {
  const above = `Au-delà de ${fmt(r.h2_above_signs)} signes, `;
  if (!r.outline_h2_min) return `${above}les intertitres sont facultatifs ; un h2 tous les 2 à 4`;
  const n = r.outline_h2_min === 1 ? "un h2" : `${r.outline_h2_min} h2`;
  return `${above}place au moins ${n} ; un h2 tous les 2 à 4`;
}

export const SYSTEM = `Tu es journaliste pour un média local français. Tu écris des articles de presse
originaux, factuels, sobres, en français, ancrés dans le territoire. Tu ne recopies jamais les
formulations d'une source : tu reformules et tu structures. Tu dis toujours qui parle : une
information vient d'un émetteur, jamais de la rédaction. Tu réponds uniquement en JSON.`;

/* Date de publication de la source, en clair (« 29 septembre 2026 »). Le modèle
   en a besoin pour dater l'événement au lieu d'écrire « récemment » (M3-85). */
function frDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }) : null;
}

/* Grille du ranking (M3-85). Sans elle, le modèle notait la qualité du TEXTE : un
   communiqué d'entreprise sur le Var, bien écrit, sortait à 80/100 pour un lectorat
   de Charente-Maritime. Le ranking mesure l'intérêt pour le LECTEUR de la zone.
   La tranche haute commence à SEUIL_FORT_ALIGNEMENT (shared/scoring.js), le début
   de la bande « Fort alignement » de la grille (M3-113, décision 2). */
const FORT = SEUIL_FORT_ALIGNEMENT;
const RANKING_GRID = `- RANKING (suggested_ranking) : l'intérêt pour un lecteur de la zone couverte, PAS la
  qualité de ton texte. Barème :
  ${FORT}-100 : fait local nouveau et concret qui touche directement les habitants de la zone
           (décision, ouverture, fermeture, travaux, emploi, sécurité, prix) ;
  60-${FORT - 1}  : information locale utile, mais moins nouvelle ou moins directe ;
  40-59  : sujet régional, ou d'intérêt indirect pour la zone ;
  20-39  : communication institutionnelle ou d'entreprise sans fait nouveau, ou ancrage
           local faible ;
  0-19   : sujet hors de la zone couverte, contenu promotionnel ou de partenariat.
  « ranking_reason » nomme la tranche retenue et pourquoi.`;

/* Valeurs des variables du modèle (src/llm/prompts/template.js), calculées à un
   seul endroit. `rules` : les réglages déjà complétés par rulesOf.

   Titre, balise titre et méta-description : la cible calculée sur le titre et
   le chapô de la source (fieldTargets, M3-56) quand ils sont mesurés ; sinon
   les bornes des Paramètres, texte d'avant. Slug : la règle de slugRule. */
export function variablesDe(extracted, { mode, region, altPrompt, publishedAt, partner, sourceSigns, sourceTitleChars, sourceLeadChars } = {}, rules = rulesOf()) {
  const r = rules;
  /* La mesure vient de l'appelant, ou des éléments extraits (`source_signs`,
     posé à l'extraction) : une régénération n'a que ces derniers. */
  const target = lengthTarget(r, sourceSigns ?? extracted?.source_signs);
  const fields = fieldTargets(r, {
    sourceTitleChars: sourceTitleChars ?? extracted?.source_title_chars,
    sourceLeadChars: sourceLeadChars ?? extracted?.source_lead_chars,
  });
  const date = frDate(publishedAt);
  return {
    consigne_mode: mode === "press"
      ? "Mode : réécriture à partir d'un article de presse existant. Produis un contenu ORIGINAL : structure différente, formulations différentes, pas de plagiat."
      : "Mode : rédaction à partir d'une source officielle (communiqué / institution). Traduis l'information en article journalistique.",
    /* La zone couverte sert à JUGER l'intérêt local (ranking), jamais à écrire. Le
       13/10, « Région de référence : Nouvelle-Aquitaine » plus la consigne d'angle
       local ont fait écrire « notamment en Nouvelle-Aquitaine » dans un article sur
       le Var — ce que la source ne disait pas — et le géo-tag s'y est laissé prendre. */
    zone: region || "Nouvelle-Aquitaine",
    date_source: date || "",
    phrase_date_source: date ? `Source publiée le ${date}.\n` : "",
    phrase_partenariat: partner ? "Nature de la source : contenu de partenariat ou communication de marque — dis-le explicitement dans l'article.\n" : "",
    consigne_relecteur: altPrompt ? `Consigne supplémentaire du relecteur : ${altPrompt}` : "",
    elements_extraits: JSON.stringify(forModel(extracted), null, 2),
    regle_titre: fieldRule("title", r, fields.title),
    rubriques: Object.keys(CAT).join(", "),
    regle_longueur: lengthRule(r, target),
    grille_ranking: RANKING_GRID,
    regle_h2: h2Rule(r),
    intertitre_max: String(r.h2_title_max),
    regle_balise_titre: fieldRule("metaTitle", r, fields.metaTitle),
    regle_meta: fieldRule("metaDesc", r, fields.metaDesc),
    regle_slug: slugRule(r),
    mots_cles_min: String(r.keywords_min),
  };
}

/* Prompt de génération. `opts.template` : le modèle retenu pour ce moteur
   (M3-56, résolu dans src/llm/index.js) ; absent, le prompt général du code.
   Le format de sortie n'en fait jamais partie : il est TOUJOURS ajouté ici,
   après le modèle rendu. */
export function userPrompt(extracted, opts = {}) {
  const vars = variablesDe(extracted, opts, rulesOf(opts.rules));
  const body = renderTemplate(opts.template ?? DEFAULT_TEMPLATE, vars).replace(/\s+$/, "");
  return body + FORMAT_SORTIE;
}
