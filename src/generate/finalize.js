/* Post-traitement commun d'un article généré (pipeline + « Renvoyer à l'IA ») :
   nettoyage des dates, géo-tag depuis le contenu, contrôle de date, garde-fou rubrique. */

import { detectZone, unsourcedPlaces } from "./geo.js";
import { reconcileCategory } from "./classify.js";
import { contentDate, assessDate, stripDateNoise } from "./dates.js";
import { zoneClassOf, asBlocks, isHeading } from "../../shared/model.js";
import { coveredOf, mainRegionName } from "../../shared/zones.js";
import { wordsOf } from "../../shared/scoring.js";
import { lengthTarget, withinTarget } from "../llm/lengthTarget.js";
import { rulesOf, evaluateRules, REGLES_CONTROLEES, slugify, slugRuleOk } from "../llm/rules.js";
import { sourceSignsOf } from "./quality.js";

/* Longueur de l'article face à sa cible (M3-86). La cible est celle que le
   prompt a reçue (`gen.lengthTarget`, posée par generateArticle) ; à défaut —
   appelant qui ne passe pas par src/llm/index.js —, la même fonction la
   recalcule sur la source. Gardée dans `checks.length` : c'est la valeur que la
   grille de notation doit relire pour juger la longueur comme le prompt l'a
   demandée. */
export function lengthCheck(gen, { rawText = "", settings = {} } = {}) {
  const target = gen.lengthTarget !== undefined
    ? gen.lengthTarget
    : lengthTarget(rulesOf(settings), sourceSignsOf(rawText));
  if (!target) return null;
  const signs = wordsOf(gen);
  return { ...target, signs, ok: withinTarget(target, signs) };
}

/* Contrôle final des règles des Paramètres (M3-87), APRÈS les corrections
   mécaniques de finalize (titre de secours, balise titre, slug) : c'est l'état
   de l'article tel qu'il sera relu. `gen.ruleCheck` est posé par
   generateArticle pour un vrai moteur. Le mock n'en a pas : ses règles sont
   mesurées quand même (`checked`, M3-113), sans relance ni signalement
   (`attempts` = 0) — il est de toute façon bloqué à la parution.
   `extra` : les preuves que seul finalize sait mesurer (attribution,
   citations, lieux, rubrique), ajoutées à `checked`. */
export function rulesCheck(gen, settings = {}, extra = []) {
  if (!gen) return null;
  const target = gen.lengthTarget !== undefined ? gen.lengthTarget : null;
  /* Fenêtres du titre et des méta (M3-86), posées par generateArticle comme la
     cible du corps ; absentes = règle d'avant. */
  const fields = gen.fieldTargets || null;
  const { violations, checked } = evaluateRules(gen, settings, target, fields);
  const ordre = REGLES_CONTROLEES.map((x) => x.cle);
  return {
    attempts: gen.ruleCheck ? gen.ruleCheck.attempts || 1 : 0,
    stopped: gen.ruleCheck ? gen.ruleCheck.stopped || null : null,
    violations: violations.map(({ rule, detail }) => ({ rule, detail })),
    checked: [...checked, ...(extra || []).filter(Boolean)]
      .sort((a, b) => ordre.indexOf(a.cle) - ordre.indexOf(b.cle)),
  };
}

const LEADIN_RE = /^(le\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2})[^,.]*,\s+|aujourd['’]hui,?\s+|suite\s+[àa]\s+[^,.]*,\s+|afin\s+de\s+[^,.]*,\s+|dans\s+le\s+cadre\s+de\s+[^,.]*,\s+|[àa]\s+l['’]occasion\s+de\s+[^,.]*,\s+|depuis\s+le\s+\d[^,.]*,\s+|d[èe]s\s+le\s+\d[^,.]*,\s+|les?\s+\d{1,2}\s+(?:et\s+\d{1,2}\s+)?[a-zà-ÿ]+\s+\d{4},?\s+|du\s+\d{1,2}\s+(?:au|et)\s+\d{1,2}[^,.]*,\s+)/i;

function looksLikeSentence(t) {
  const w = t.trim().split(/\s+/);
  const commas = (t.match(/,/g) || []).length;
  return t.endsWith("…") || t.endsWith("...") || w.length > 13 || commas >= 2 || LEADIN_RE.test(t) ||
    /^(vous\s|notre\s|et\s+si\s|comment\s|dans\s+\d)/i.test(t) ||
    /invit[ée]e?\s+de\s+l|r[ée]pond(?:re)?\s+aux\s+questions|sur\s+le\s+plateau|au\s+micro\s+de|est\s+de\s+retour|poursuit\s+sa\s+s[ée]rie/i.test(t) ||
    /^(le\s+portail|le\s+premier\s+quartile|le\s+d[ée]partement\s+de|acteur\s+majeur|un\s+des\s+leaders)/i.test(t);
}

/* Marques Markdown laissées par le modèle (« *La Provence* », « **important** ») :
   le texte est brut, elles s'afficheraient telles quelles. Seules les paires
   accolées à un mot sont retirées — un astérisque isolé (« * conditions ») reste. */
export function stripMarkdown(s) {
  return String(s || "")
    .replace(/(\*\*|__)(?=\S)([^*_\n]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/^#{1,6}\s+/, "");
}

/* Citations retouchées (M3-85). Entre guillemets, ce sont les mots exacts de la
   personne : une citation de l'article doit figurer TELLE QUELLE dans la source.
   Le 13/10, « On ne vient pas apporter la bonne parole ; on est dans l'expérience
   d'une rencontre et d'un échange » est devenu « apporter la bonne parole, mais
   de vivre une expérience de rencontre et d'échange » — six citations justes sur
   sept, la septième remaniée. Comparaison sur les MOTS (ponctuation, tirets, casse
   et apostrophes ignorés) ; une coupe « (…) » ou « … » sépare des fragments vérifiés
   chacun. Moins de cinq mots : un titre, un terme (« surf »), pas une parole.
   → les citations introuvables, raccourcies pour l'affichage. */
const words = (s) => String(s).toLowerCase().replace(/[’`]/g, "'")
  .replace(/[^\p{L}\p{N}']+/gu, " ").trim();
/* Le même parcours compte aussi les citations vérifiées (M3-107) : `total` =
   citations d'au moins un fragment de cinq mots, `altered` = celles qui ne sont
   pas dans la source. checks.sources en tire « n/m retrouvées telles quelles ». */
export function quoteCheck(text, source) {
  const src = ` ${words(source)} `;
  const altered = [];
  let total = 0;
  for (const m of String(text).matchAll(/«\s*([^«»]+?)\s*»|“([^“”]+)”/g)) {
    const q = m[1] || m[2];
    const parts = q.split(/\(…\)|\[…\]|\(\.\.\.\)|…|\.\.\./).map(words).filter((p) => p.split(" ").length >= 5);
    if (parts.length) total++;
    if (parts.some((p) => !src.includes(` ${p} `))) altered.push(q.length > 70 ? `${q.slice(0, 67)}…` : q);
  }
  return { total, altered };
}
export function alteredQuotes(text, source) {
  return quoteCheck(text, source).altered;
}

/* État de LA source (M3-107), gardé dans checks.sources à la génération.
   Seuil de lisibilité : celui sous lequel finalize saute déjà les contrôles de
   citations et de lieux (« sans texte source exploitable »). Recopié dans
   src/relireArticles/relireArticles.regles.ts (SOURCE_LISIBLE_MIN), qui dérive
   l'état des articles anciens : les deux doivent rester égaux. */
export const SOURCE_LISIBLE_MIN = 200;
const normSpaces = (s) => String(s || "").replace(/\s+/g, " ").trim();

/* « Émetteur nommé » : l'article cite-t-il l'organisme qui a publié la source ?
   Heuristique sur le NOM de la source (celui du référentiel), comparé sans
   casse, accents ni ponctuation, mot à mot :
   - le nom entier figure dans le texte → oui ;
   - sinon chaque mot distinctif du nom (≥ 3 lettres, hors mots génériques :
     ville, mairie, préfecture, conseil…) doit y figurer, et si le nom désigne
     une institution (ville, mairie, préfecture…), l'un de ces mots aussi :
     « Ville de Rochefort » est nommée par « la mairie de Rochefort », pas par
     un simple « à Rochefort » ;
   - nom fait de seuls mots génériques (« Préfecture ») : il doit figurer tel quel.
   Sans nom transmis : null (inconnu). */
const fold = (s) => ` ${String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim()} `;
const INSTITUTIONS = ["ville", "mairie", "commune", "communaute", "agglomeration", "agglo", "metropole",
  "departement", "conseil", "region", "prefecture", "office"];
const GENERIQUES = new Set([...INSTITUTIONS, "communes", "departemental", "departementale", "regional", "regionale",
  "sous", "site", "officiel", "officielle", "les", "des", "aux", "pour", "sur", "par", "www", "com", "org", "gouv"]);
export function emitterNamed(sourceName, text) {
  const nom = fold(sourceName).trim();
  if (!nom) return null;
  const t = fold(text);
  if (t.includes(` ${nom} `)) return true;
  const mots = nom.split(" ");
  const distinctifs = mots.filter((m) => m.length >= 3 && !GENERIQUES.has(m));
  if (!distinctifs.length) return false;
  if (!distinctifs.every((m) => t.includes(` ${m} `))) return false;
  if (!mots.some((m) => INSTITUTIONS.includes(m))) return true;
  return INSTITUTIONS.some((m) => t.includes(` ${m} `));
}

/* Une entrée de checks.sources (une seule source par article en M3).
   `citations` : null quand le contrôle de citations n'a pas tourné (source
   trop mince). `motif` n'existe que pour une source illisible. */
export function sourceCheck({ url = null, sourceName = null, rawText = "", extracted = null, fullText = "", quotes = null } = {}) {
  const mince = String(rawText || "").length <= SOURCE_LISIBLE_MIN;
  const repli = !!(extracted && extracted._sourceType);
  return {
    url: url || null,
    etat: mince || repli ? "illisible" : "lue",
    ...(mince || repli ? { motif: mince ? "texte_mince" : "extraction_repli" } : {}),
    signes: normSpaces(rawText).length,
    emetteurNomme: emitterNamed(sourceName, fullText),
    citations: quotes ? { trouvees: quotes.total - quotes.altered.length, total: quotes.total } : null,
  };
}

/* --- preuves de checks.rules.checked que seul finalize sait mesurer (M3-113) ---
   Même format que celles de checkRules (src/llm/rules.js). Aucune ne relance
   le modèle (`retry: false`). Source trop mince : non mesuré, avec le motif
   chiffré — c'est désormais le seul usage de « l'état de la source ». */
const sourceMince = (rawText) => String(rawText || "").length <= SOURCE_LISIBLE_MIN;
const motifMince = (rawText) => {
  const n = normSpaces(rawText).length;
  return n ? `source de ${n} signe${n > 1 ? "s" : ""}` : "aucun texte source";
};
const preuve = (cle, attendu, obtenu, ok, motif) => ({ cle, attendu, obtenu, ok, ...(motif ? { motif } : {}), retry: false });

/* R13, ATTRIBUTION : « dès le premier ou le deuxième paragraphe, nomme
   l'émetteur » (src/llm/prompts/template.js). Mesurée sur le titre, le chapô et
   les deux premiers paragraphes — la portée qu'exige le prompt, pas tout le
   texte (checks.sources[0].emetteurNomme, lui, garde tout le texte). */
const ATTRIBUTION_PORTEE = "titre, chapô ou deux premiers paragraphes";
export function attributionCheck({ sourceName = null, rawText = "", title = "", chapo = "", paras = [] } = {}) {
  const attendu = { texte: `émetteur nommé dans le ${ATTRIBUTION_PORTEE}` };
  const nom = String(sourceName || "").trim();
  if (!nom) return preuve("attribution", attendu, { texte: "non mesuré" }, null, "source sans nom");
  if (sourceMince(rawText)) return preuve("attribution", attendu, { texte: "non mesuré" }, null, motifMince(rawText));
  const ok = emitterNamed(nom, [title, chapo, ...paras.slice(0, 2)].join("\n"));
  return preuve("attribution", attendu,
    { valeur: nom, texte: ok ? `« ${nom} » nommé` : `« ${nom} » absent du ${ATTRIBUTION_PORTEE}` }, ok);
}

/* R14, CITATIONS : mot pour mot entre « ». `quotes` = quoteCheck, null quand
   le contrôle n'a pas tourné (source trop mince). */
export function citationsCheck({ rawText = "", quotes = null } = {}) {
  const attendu = { texte: "citations mot pour mot de la source" };
  if (!quotes) return preuve("citations", attendu, { texte: "non vérifiées" }, null, motifMince(rawText));
  if (!quotes.total) return preuve("citations", attendu, { valeur: 0, texte: "aucune citation" }, null, "aucune citation à vérifier");
  const trouvees = quotes.total - quotes.altered.length;
  return preuve("citations", attendu,
    { valeur: trouvees, texte: `${trouvees}/${quotes.total} mot pour mot`, absentes: quotes.altered }, quotes.altered.length === 0);
}

/* R15, lieux : aucun lieu de la zone absent de la source. `lieux` = lieux de
   la zone cités par l'article, `absents` = ceux que la source ne cite pas
   (unsourcedPlaces ; null = contrôle sauté, source trop mince). */
export function lieuxCheck({ rawText = "", lieux = [], absents = null } = {}) {
  const attendu = { texte: "aucun lieu absent de la source" };
  if (!absents) return preuve("lieux", attendu, { texte: "non vérifiés" }, null, motifMince(rawText));
  if (!lieux.length) return preuve("lieux", attendu, { valeur: 0, texte: "aucun lieu cité", lieux, absents }, null, "aucun lieu de la zone cité");
  const presents = lieux.length - absents.length;
  return preuve("lieux", attendu,
    { valeur: presents, texte: `${presents}/${lieux.length} présent${presents > 1 ? "s" : ""} dans la source`, lieux, absents }, absents.length === 0);
}

/* R18, rubrique : celle du modèle, gardée sauf si le texte la contredit
   (reconcileCategory). `cat` = { from, auto, overridden } de checks.category. */
export function rubriqueCheck(cat) {
  const attendu = { texte: "rubrique pertinente pour le texte" };
  if (!cat || !cat.auto) return preuve("rubrique", attendu, { texte: "aucune rubrique" }, null, "aucune rubrique");
  return preuve("rubrique", attendu,
    { valeur: cat.auto, texte: cat.overridden ? `« ${cat.from} » corrigée en « ${cat.auto} »` : `${cat.auto} retenue` }, !cat.overridden);
}

/* Balise titre trop longue : la grille la refuse au-delà de meta_title_max, et
   les modèles la dépassent souvent. Coupée à la frontière d'un mot plutôt que
   laissée à corriger à la main sur chaque article. */
function fitMetaTitle(seo, title, max) {
  if (!seo) return;
  const mt = String(seo.metaTitle || "").trim();
  if (mt && mt.length <= max) return;
  const base = mt || String(title || "");
  seo.metaTitle = base.length <= max ? base : base.slice(0, max + 1).replace(/\s+\S*$/, "").replace(/[\s,;:–-]+$/, "");
}

function tidy(t) {
  let s = stripDateNoise(String(t || "")).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2 && LEADIN_RE.test(s); i++) s = s.replace(LEADIN_RE, "");
  s = s.replace(/^[«"'\s,–-]+/, "").replace(/[…\s.,;:–-]+$/, "");
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  // couper proprement à ~90 caractères sur une frontière de mot
  if (s.length > 92) s = s.slice(0, 92).replace(/\s+\S*$/, "");
  return s;
}

const wc = (s) => String(s).trim().split(/\s+/).filter((w) => w.length > 1).length;

/* Choisit le meilleur titre disponible ; à défaut, en fabrique un depuis le corps.
   `body` est ici le texte des PARAGRAPHES seulement : fabriquer un titre à partir
   d'un intertitre donnerait une étiquette, pas une accroche. */
function fixTitle(llmTitle, { titleHint, body = [] } = {}) {
  const clean = tidy(llmTitle);
  const hint = tidy(titleHint);
  const hintOK = hint && !looksLikeSentence(hint) && wc(hint) >= 4;

  const cleanOK = clean && !looksLikeSentence(clean) && wc(clean) >= 4;
  if (cleanOK) {
    // accroche du LLM trop courte/incomplète alors qu'une meilleure existe
    if (wc(clean) < 5 && hintOK && wc(hint) > wc(clean)) return hint;
    return clean;
  }
  if (hintOK) return hint;

  // fabriquer : première proposition « sujet + verbe » du 1er paragraphe
  const first = tidy(String(body[0] || llmTitle || "").split(/(?<=[.!?])\s/)[0]);
  // enlever une apposition en tête (« X, fonction, … » → « X … »)
  const noApp = first.replace(/^([A-ZÀ-Þ][^,]{2,40}),\s+[^,]{3,60},\s+/, "$1 ");
  const clause = noApp.split(/,\s+(?=(?:le|la|les|un|une|afin|dans|pour|qui|ce|cette|selon)\b)/i)[0];
  const cand = tidy(clause).split(/\s+/).slice(0, 13).join(" ");
  if (wc(cand) >= 5 && !looksLikeSentence(cand)) return cand;
  if (wc(cand) >= 4) return cand;
  // dernier recours : accroche du LLM tronquée proprement (mieux que rien)
  return tidy(clean || hint).split(/\s+/).slice(0, 12).join(" ") || "Information locale";
}

/* gen : { title, chapo, body[{type,text}], category, ... } (muté)
   ctx : { rawText, publishedAt, sourceZone, extractedLocality, settings }
   → { flags: [...], zone, zoneClass, checks:{date,geo,category} } */
export function finalizeGenerated(gen, ctx = {}) {
  const { rawText = "", publishedAt = null, sourceZone = {}, sourceDept = null, sourceRegion = null, extractedLocality = null, settings = {} } = ctx;
  /* Facultatifs (M3-107), pour checks.sources : nom et adresse de la source,
     extraction (le mock marque la sienne `_sourceType`). */
  const { sourceName = null, sourceUrl = null, extracted = null } = ctx;
  const flags = [];

  gen.title = stripMarkdown(stripDateNoise(gen.title || ""));
  gen.chapo = stripMarkdown(stripDateNoise(gen.chapo || ""));

  /* Le corps est une suite de blocs typés. Trois règles d'hygiène, dans l'ordre :
     nettoyer le texte, jeter les blocs vides, puis retirer les intertitres
     orphelins — un h2 en dernière position, ou suivi d'un autre intertitre,
     annonce une section qui n'existe pas. */
  gen.body = asBlocks(gen.body)
    .map((b) => ({ ...b, text: stripMarkdown(stripDateNoise(b.text)) }))
    .filter((b) => b.text.trim().length > 0)
    .filter((b, i, arr) => !isHeading(b) || (arr[i + 1] && !isHeading(arr[i + 1])));
  if (gen.body.length === 0) {
    gen.body = asBlocks([gen.chapo || gen.title || "—"]);
  }

  const paras = gen.body.filter((b) => !isHeading(b)).map((b) => b.text);
  const fullText = `${gen.title}\n${gen.chapo}\n${gen.body.map((b) => b.text).join("\n")}`;

  const covered = coveredOf(settings);
  const zoneOpts = {
    extractedLocality,
    region: mainRegionName(covered) || sourceZone.region || "Nouvelle-Aquitaine",
    sourceDept: sourceDept || sourceZone.dept || null,
    sourceRegion,
    covered,
  };
  let zone = detectZone(fullText, zoneOpts);
  let quotes = null;
  let absents = null;
  /* Lieux de la zone inventés (M3-85) : l'article en cite que la source ne cite
     pas. Signalé « Hallucination possible », et la zone se lit alors dans la
     SOURCE — sans quoi l'invention elle-même rend l'article « habilité » (le
     13/10 : « notamment en Nouvelle-Aquitaine » sur un sujet du Var). Contrôle
     sauté sans texte source exploitable : tout y paraîtrait inventé. */
  if (!sourceMince(rawText)) {
    quotes = quoteCheck(fullText, rawText);
    const altered = quotes.altered;
    if (altered.length) {
      flags.push({ type: "citation_a_verifier", detail: `Absente telle quelle de la source : « ${altered.join(" » ; « ")} ». Rétablir les mots exacts ou retirer les guillemets.`, at: new Date().toISOString() });
    }
    const invented = unsourcedPlaces(fullText, `${extractedLocality || ""}\n${rawText}`, covered);
    absents = invented;
    if (invented.length) {
      flags.push({ type: "hallucination", detail: `Lieu(x) absent(s) de la source : ${invented.join(", ")}. Vérifier l'ancrage local.`, at: new Date().toISOString() });
      zone = detectZone(rawText, zoneOpts);
    }
  }
  // commune : UNIQUEMENT celle détectée dans le contenu de l'article — jamais celle
  // de la source. Le DÉPARTEMENT peut toutefois venir de la source si elle est
  // explicitement départementale (zone.origin === "source").

  // titre : nettoyage + secours si l'accroche du LLM est mauvaise
  const before = gen.title;
  gen.title = fixTitle(gen.title, { titleHint: ctx.titleHint, body: paras });
  if (gen.title !== before && gen.seo) {
    if (!gen.seo.metaTitle || gen.seo.metaTitle.length > 60 || looksLikeSentence(gen.seo.metaTitle)) {
      gen.seo.metaTitle = gen.title.slice(0, 60).replace(/\s+\S*$/, "");
    }
    /* Le H1 du plan n'est plus recopié ici : il EST le titre (outlineOf). */
    const s = slugify(before, rulesOf(settings));
    if (!gen.seo.slug || !/^[a-z0-9-]+$/.test(gen.seo.slug) || gen.seo.slug === s) {
      gen.seo.slug = slugify(gen.title, rulesOf(settings));
    }
  }
  /* Balise titre : le plafond est celui de la fenêtre (M3-86) quand elle existe. */
  const mtMax = gen.fieldTargets?.metaTitle?.max ?? (settings.meta_title_max || 60);
  fitMetaTitle(gen.seo, gen.title, mtMax);
  /* Slug hors règle (format, 6 mots, mots vides, dates — slug_max_words) :
     refait ici plutôt que redemandé au modèle (M3-87) — une règle mécanique ne
     vaut pas le prix d'une génération. Même fonction que le contrôle. */
  if (gen.seo && !slugRuleOk(gen.seo.slug, rulesOf(settings))) {
    gen.seo.slug = slugify(gen.seo.slug || gen.title, rulesOf(settings));
  }
  if (zone.outsideNA) {
    flags.push({
      type: "hors_sujet",
      detail: `Contenu hors des zones couvertes (localité : « ${extractedLocality || "?"} »).`,
      at: new Date().toISOString(),
    });
  }

  const cd = contentDate(gen.title, rawText);
  /* Repli = défaut du réglage (72 h, yamlStore.js), et non plus 336 (M3-113).
     Gardée dans checks.date : l'attendu de la preuve « fraîcheur de la source ». */
  const windowHours = settings.window_hours || 72;
  const dateCheck = assessDate({
    contentDt: cd && cd.date,
    contentSource: cd && cd.source,
    harvestPublishedAt: publishedAt,
    windowHours,
  });
  if (!dateCheck.ok) {
    flags.push({ type: "date_suspecte", detail: dateCheck.detail, at: new Date().toISOString() });
  }

  const catFix = reconcileCategory(gen.category, fullText);
  if (catFix.overridden) gen.category = catFix.cat;
  /* Toujours rempli (M3-113) : la rubrique retenue se prouve même sans correction. */
  const category = {
    from: catFix.overridden ? catFix.from : gen.category ?? null,
    auto: catFix.cat ?? null,
    overridden: !!catFix.overridden,
    ...(catFix.overridden ? { evidence: catFix.evidence } : {}),
  };

  const rules = rulesCheck(gen, settings, [
    attributionCheck({ sourceName, rawText, title: gen.title, chapo: gen.chapo, paras: gen.body.filter((b) => !isHeading(b)).map((b) => b.text) }),
    citationsCheck({ rawText, quotes }),
    /* Lieux cités : ceux que lit le contrôle, comparés à une source vide. */
    lieuxCheck({ rawText, lieux: absents ? unsourcedPlaces(fullText, "", covered) : [], absents }),
    rubriqueCheck(category),
  ]);
  /* Mock (sans ruleCheck) : mesuré, pas signalé. */
  if (gen.ruleCheck && rules.violations.length) {
    flags.push({
      type: "regles_non_tenues",
      detail: `Règles des Paramètres non tenues après ${rules.attempts} demande(s) au modèle : ${rules.violations.map((v) => v.detail).join(" ; ")}.`,
      at: new Date().toISOString(),
    });
  }

  return {
    flags,
    zone: { num: zone.num, dept: zone.dept, region: zone.region, commune: zone.commune, regionOnly: !!zone.regionOnly, outsideNA: !!zone.outsideNA, origin: zone.origin || "content" },
    zoneClass: zoneClassOf(zone, covered),
    checks: {
      date: { detected: dateCheck.date ? dateCheck.date.toISOString() : null, source: cd && dateCheck.date === cd.date ? cd.source : null, ok: dateCheck.ok, reason: dateCheck.reason, windowHours },
      geo: { num: zone.num, commune: zone.commune, regionOnly: !!zone.regionOnly, outsideNA: zone.outsideNA, locality: extractedLocality || null, origin: zone.origin || "content" },
      category,
      length: lengthCheck(gen, { rawText, settings }),
      rules,
      /* M3-107 : état de la source, émetteur nommé, citations retrouvées —
         sur le texte dont les citations viennent d'être vérifiées. */
      sources: [sourceCheck({ url: sourceUrl, sourceName, rawText, extracted, fullText, quotes })],
    },
  };
}
