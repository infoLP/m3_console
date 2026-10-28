/* M3-56 — prompts de génération modifiables au back-office.

   Ce qui compte :
   - le prompt général du code, réécrit en modèle à variables, redonne À L'OCTET
     PRÈS le texte d'avant (référence figée ci-dessous) ;
   - liste fermée de variables, variables indispensables, format de sortie
     verrouillé : un modèle qui enfreint l'un des trois est refusé ;
   - résolution (moteur, modèle) > (moteur) > général > défaut du code, un
     modèle invalide en base étant sauté ;
   - le prompt est construit PAR MOTEUR : le secours reçoit le sien ;
   - base illisible → prompt du code, sans faire échouer la génération. */

import test from "node:test";
import assert from "node:assert/strict";

import { lengthTarget, fieldTargets, fieldRule } from "../src/llm/lengthTarget.js";
import { rulesOf, slugRule } from "../src/llm/rules.js";
import { userPrompt, variablesDe } from "../src/llm/prompts/generate.js";
import {
  PROMPT_VARIABLES, REQUIRED_VARIABLES, DEFAULT_TEMPLATE, FORMAT_SORTIE,
  renderTemplate, validateTemplate, resolvePrompt, EXEMPLE_EXTRAITS, EXEMPLE_OPTIONS,
} from "../src/llm/prompts/template.js";
import * as llm from "../src/llm/index.js";

const warnings = [];
console.warn = (m) => warnings.push(String(m));
delete process.env.DATABASE_URL;

/* ---------------------------------------------------------------- référence
   userPrompt() tel qu'il était avant M3-56, recopié tel quel. Seuls écarts,
   voulus : la consigne du slug (slugRule, règle des 6 mots) et les fragments de
   longueur du titre / balise / méta (fieldRule, identiques sans cible). */
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
function refLengthRule(r, t) {
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
function refForModel(e) {
  if (!e || typeof e !== "object") return e;
  const { source_signs: _a, source_title_chars: _b, source_lead_chars: _c, ...rest } = e;
  return rest;
}
function refH2Rule(r) {
  const above = `Au-delà de ${fmt(r.h2_above_signs)} signes, `;
  if (!r.outline_h2_min) return `${above}les intertitres sont facultatifs ; un h2 tous les 2 à 4`;
  const n = r.outline_h2_min === 1 ? "un h2" : `${r.outline_h2_min} h2`;
  return `${above}place au moins ${n} ; un h2 tous les 2 à 4`;
}
function refFrDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }) : null;
}
const RANKING_GRID = `- RANKING (suggested_ranking) : l'intérêt pour un lecteur de la zone couverte, PAS la
  qualité de ton texte. Barème :
  80-100 : fait local nouveau et concret qui touche directement les habitants de la zone
           (décision, ouverture, fermeture, travaux, emploi, sécurité, prix) ;
  60-79  : information locale utile, mais moins nouvelle ou moins directe ;
  40-59  : sujet régional, ou d'intérêt indirect pour la zone ;
  20-39  : communication institutionnelle ou d'entreprise sans fait nouveau, ou ancrage
           local faible ;
  0-19   : sujet hors de la zone couverte, contenu promotionnel ou de partenariat.
  « ranking_reason » nomme la tranche retenue et pourquoi.`;

function refUserPrompt(extracted, { mode, region, altPrompt, rules, publishedAt, partner, sourceSigns } = {}) {
  const r = rulesOf(rules);
  const target = lengthTarget(r, sourceSigns ?? extracted?.source_signs);
  const f = fieldTargets(r, { sourceTitleChars: extracted?.source_title_chars, sourceLeadChars: extracted?.source_lead_chars });
  const modeLine = mode === "press"
    ? "Mode : réécriture à partir d'un article de presse existant. Produis un contenu ORIGINAL : structure différente, formulations différentes, pas de plagiat."
    : "Mode : rédaction à partir d'une source officielle (communiqué / institution). Traduis l'information en article journalistique.";
  const date = refFrDate(publishedAt);
  return `${modeLine}
Zone couverte par le média : ${region || "Nouvelle-Aquitaine"}. Elle sert UNIQUEMENT à juger l'intérêt
local (ranking). N'écris JAMAIS que le sujet concerne cette zone, ni aucun lieu, si les éléments
extraits ne le disent pas.
${date ? `Source publiée le ${date}.\n` : ""}${partner ? "Nature de la source : contenu de partenariat ou communication de marque — dis-le explicitement dans l'article.\n" : ""}${altPrompt ? `Consigne supplémentaire du relecteur : ${altPrompt}` : ""}

ÉLÉMENTS EXTRAITS :
${JSON.stringify(refForModel(extracted), null, 2)}

Contraintes :
- TITRE : une vraie accroche de presse, avec un verbe, ${fieldRule("title", r, f.title)}. JAMAIS
  une reprise de la première phrase du texte, jamais un fragment tronqué finissant
  par « … », jamais une date en tête (« Le 14 octobre 2026, … »).
- RUBRIQUE : choisis LA plus pertinente parmi les 5. Repères : santé animale /
  agriculture / eau / climat → Environnement ; santé publique / social / école /
  sécurité / services publics → Société ; emploi / entreprises / commerce /
  logement / tourisme → Économie ; sport uniquement si l'article parle vraiment
  de compétition, club ou pratique sportive.
- N'explique JAMAIS ce qu'est un communiqué de presse, ni son cadre réglementaire.
  Ignore mentions légales, disclaimers, déclarations prospectives, codes ISIN,
  et les mentions « Publié le … » / « Mis à jour le … ».
${refLengthRule(r, target)}
- Aucune phrase creuse (« les prochaines semaines permettront d'en mesurer la portée »,
  « un point sur la situation », « les acteurs du territoire suivent de près »).
- ATTRIBUTION : dès le premier ou le deuxième paragraphe, nomme l'émetteur de
  l'information (« selon …», « annonce …», « indique … »). Un communiqué n'est jamais
  présenté comme un constat de la rédaction. Une communication d'entreprise ou un
  contenu de partenariat se dit comme tel.
- CITATIONS : si les éléments extraits contiennent des citations, reprends-en au moins
  une MOT POUR MOT, entre guillemets français « … », attribuée (nom et fonction).
  N'invente jamais une citation, ne la paraphrase pas entre guillemets : entre « … », ce
  sont les MOTS EXACTS de la personne, ou une coupe signalée par « (…) ». Une citation
  sans auteur nommé ne se reprend pas comme une parole (« un porte-parole » ne suffit
  pas), et le titre d'un document, d'un dossier ou d'un slogan n'est pas une citation.
- DATE : situe l'événement par une date explicite quand la source la donne. Jamais
  « récemment » ou « la récente … » sans date. Une date relative (« le 19 septembre
  dernier », « samedi dernier ») se compte depuis la date de publication de la source ;
  ne prends JAMAIS l'année d'une autre phrase (« En 2024, le projet est lancé » ne date
  pas une inauguration « du 19 septembre dernier »). Dans le doute, n'écris pas l'année.
- ANGLE : n'emprunte pas l'ordre de la source paragraphe par paragraphe. Commence par ce
  qui concerne le plus le lecteur. Si rien ne concerne la zone couverte, ne fabrique
  pas de lien local : le ranking le dira.
- TEXTE BRUT : aucune mise en forme Markdown (*, **, _, #) dans les textes ; un titre
  d'œuvre ou de journal s'écrit sans marque.
- Chapô de 1 à 2 phrases, purement factuel. Il résume l'essentiel ; le premier
  paragraphe ne le répète pas : il apporte le contexte ou un fait nouveau.
- FIN : termine sur un fait concret (date, chiffre, prochaine étape, où s'informer),
  JAMAIS sur une généralité (« ces sujets illustrent la complexité des défis… »,
  « l'avenir dira… »).
${RANKING_GRID}
- STRUCTURE : le corps est une suite de blocs typés. « p » = paragraphe,
  « h2 » = intertitre, « h3 » = sous-intertitre d'un h2 qui précède.
  ${refH2Rule(r)}
  paragraphes environ. Une BRÈVE courte n'a pas besoin d'intertitre.
  Un intertitre est court (≤ ${r.h2_title_max} caractères), informatif, sans point final,
  et il est TOUJOURS suivi d'au moins un paragraphe.
  N'émets JAMAIS de h1 : le titre de l'article est le seul H1.
- Balise titre ${fieldRule("metaTitle", r, f.metaTitle)}, méta-description ${fieldRule("metaDesc", r, f.metaDesc)}.
- ${slugRule(r)}
- Au moins ${r.keywords_min} mots-clés.
- Les limites chiffrées ci-dessus (titre, intertitres, longueur, balise titre,
  méta-description, mots-clés) sont IMPÉRATIVES : ta réponse est contrôlée
  automatiquement, et rejetée si une seule n'est pas tenue. Compte avant de répondre.

Réponds en JSON :
{
  "title": "...",
  "chapo": "...",
  "body": [
    {"type": "p", "text": "paragraphe d'attaque"},
    {"type": "h2", "text": "Intertitre"},
    {"type": "p", "text": "paragraphe"},
    {"type": "p", "text": "paragraphe"}
  ],
  "category": "Économie|Culture|Environnement|Société|Sport",
  "suggested_ranking": 0-100,
  "ranking_reason": "justification courte",
  "seo": {
    "metaTitle": "...",
    "metaDescription": "...",
    "slug": "...",
    "keywords": ["...", "...", "..."]
  }
}`;
}

/* ------------------------------------------------------------ équivalence */

const EXTRAITS = {
  title_hint: "Rochefort ouvre une médiathèque",
  facts: ["La médiathèque ouvre le 2 novembre.", "Accolades {{zone}} dans une source : jamais réinterprétées."],
  quotes: [{ text: "Enfin !", author: "Jean Martin", role: "maire" }],
  locality: "Rochefort",
};

const JEUX = [
  ["vide, sans option", {}, {}],
  ["officiel, défauts", EXTRAITS, { mode: "source" }],
  ["presse + date + partenaire + relecteur", EXTRAITS, { mode: "press", region: "Charente-Maritime", publishedAt: "2026-09-24T08:00:00Z", partner: true, altPrompt: "insister sur les horaires" }],
  ["date invalide", EXTRAITS, { publishedAt: "pas une date" }],
  ["relecteur seul", EXTRAITS, { altPrompt: "plus court" }],
  ["cible de longueur (source courte)", { ...EXTRAITS, source_signs: 900 }, {}],
  ["cible de longueur (source longue) par l'appelant", EXTRAITS, { sourceSigns: 40000 }],
  ["cible à 0 %", EXTRAITS, { sourceSigns: 5000, rules: { length_source_pct: 0 } }],
  ["outline_h2_min 0", EXTRAITS, { rules: { outline_h2_min: 0 } }],
  ["outline_h2_min 1", EXTRAITS, { rules: { outline_h2_min: 1 } }],
  ["outline_h2_min 2 + réglages décalés", EXTRAITS, { rules: { outline_h2_min: 2, title_max: 77, h2_title_max: 55, meta_title_max: 55, meta_desc_min: 80, meta_desc_max: 150, keywords_min: 5 } }],
  ["titre et chapô mesurés", { ...EXTRAITS, source_signs: 3000, source_title_chars: 60, source_lead_chars: 200 }, { mode: "press" }],
];

for (const [nom, ex, opts] of JEUX) {
  test(`équivalence octet par octet : ${nom}`, () => {
    const attendu = refUserPrompt(ex, opts);
    assert.equal(userPrompt(ex, opts), attendu);
    /* Même résultat par le chemin explicite : modèle rendu + format verrouillé. */
    assert.equal(renderTemplate(DEFAULT_TEMPLATE, variablesDe(ex, opts, rulesOf(opts.rules))) + FORMAT_SORTIE, attendu);
    assert.equal(userPrompt(ex, { ...opts, template: DEFAULT_TEMPLATE }), attendu, "template explicite = défaut");
  });
}

test("les mesures de la source ne partent pas au modèle", () => {
  const p = userPrompt({ ...EXTRAITS, source_signs: 3000, source_title_chars: 60, source_lead_chars: 200 }, {});
  assert.ok(!/source_(signs|title_chars|lead_chars)/.test(p));
});

/* ---------------------------------------------------------------- variables */

test("liste fermée : chaque variable a un nom, une description ; le défaut les couvre toutes sauf les facultatives", () => {
  const noms = PROMPT_VARIABLES.map((v) => v.nom);
  assert.equal(new Set(noms).size, noms.length, "noms uniques");
  for (const v of PROMPT_VARIABLES) {
    assert.match(v.nom, /^[a-z][a-z0-9_]*$/);
    assert.ok(v.description.length > 10, v.nom);
  }
  for (const r of REQUIRED_VARIABLES) assert.ok(noms.includes(r), r);
  const vars = variablesDe({}, {}, rulesOf());
  assert.deepEqual(Object.keys(vars).sort(), [...noms].sort(), "variablesDe calcule exactement la liste");
  const absentes = noms.filter((n) => !DEFAULT_TEMPLATE.includes(`{{${n}}}`));
  assert.deepEqual(absentes.sort(), ["date_source", "rubriques"], "seules deux variables d'appoint ne servent pas au défaut");
  assert.ok(!DEFAULT_TEMPLATE.includes("Réponds en JSON"), "le format n'est pas dans le modèle");
});

test("M3-111 : chaque variable a un exemple, affichage seul — le prompt envoyé n'en dépend pas", () => {
  for (const v of PROMPT_VARIABLES) assert.equal(typeof v.exemple, "string", v.nom);
  /* Exemples courts = valeurs réelles pour l'article d'exemple de l'aperçu. */
  const reel = variablesDe(EXEMPLE_EXTRAITS, EXEMPLE_OPTIONS, rulesOf());
  for (const n of ["zone", "date_source", "regle_titre", "rubriques", "regle_h2", "intertitre_max", "regle_balise_titre", "regle_meta", "regle_slug", "mots_cles_min", "phrase_partenariat"]) {
    assert.equal(PROMPT_VARIABLES.find((v) => v.nom === n).exemple, String(reel[n]), n);
  }
  /* Un article qui n'est pas celui d'exemple : aucun exemple propre à l'article
     d'exemple (zone, date, extraits) ne fuit dans son prompt. */
  const p = userPrompt(EXTRAITS, { region: "Vendée", mode: "press" });
  for (const n of ["zone", "date_source", "phrase_date_source", "consigne_relecteur", "elements_extraits"]) {
    const ex = PROMPT_VARIABLES.find((v) => v.nom === n).exemple;
    assert.ok(!p.includes(ex), `${n} : l'exemple n'entre pas dans le prompt`);
  }
  /* Et le défaut du code reste identique à la référence, octet pour octet
     (test « le défaut redonne le prompt d'avant » plus haut). */
});

test("renderTemplate : une passe, espaces tolérés, inconnue laissée telle quelle", () => {
  assert.equal(renderTemplate("a {{ x }} b {{y}} {{z}}", { x: "1", y: "{{x}}" }), "a 1 b {{x}} {{z}}");
  assert.equal(renderTemplate("{{x}}", { x: null }), "");
});

test("modèle personnalisé : variables rendues, format toujours ajouté à la fin", () => {
  const tpl = `Écris sur ${"{{zone}}"}.\n${REQUIRED_VARIABLES.map((n) => `{{${n}}}`).join("\n")}\n\n\n`;
  assert.deepEqual(validateTemplate(tpl), []);
  const p = userPrompt(EXTRAITS, { template: tpl, region: "Vendée" });
  assert.ok(p.startsWith("Écris sur Vendée.\n"));
  assert.ok(p.endsWith(FORMAT_SORTIE), "format verrouillé à la fin");
  assert.ok(!p.includes("\n\n\n\n\nRéponds"), "blancs de fin du modèle retirés");
});

/* --------------------------------------------------------------- validation */

const VALIDE = REQUIRED_VARIABLES.map((n) => `{{${n}}}`).join("\n");

test("validation : le défaut passe", () => {
  assert.deepEqual(validateTemplate(DEFAULT_TEMPLATE), []);
});

test("validation : variable inconnue, nom invalide, accolades mal formées", () => {
  assert.ok(validateTemplate(`${VALIDE}\n{{inconnue}}`).some((e) => /variable inconnue : \{\{inconnue\}\}/.test(e)));
  assert.ok(validateTemplate(`${VALIDE}\n{{Zone}}`).some((e) => /nom de variable invalide/.test(e)));
  assert.ok(validateTemplate(`${VALIDE}\n{{zone`).some((e) => /« \{\{ » sans/.test(e)));
  assert.ok(validateTemplate(`${VALIDE}\nzone}}`).some((e) => /« \}\} » sans/.test(e)));
  assert.ok(validateTemplate(`${VALIDE}\n{zone}`).some((e) => /accolades simples/.test(e)));
});

test("validation : variables indispensables absentes, listées", () => {
  const e = validateTemplate("Écris un article sur {{zone}}.");
  const m = e.find((x) => /indispensables? absentes?/.test(x));
  assert.ok(m);
  for (const r of REQUIRED_VARIABLES) assert.ok(m.includes(`{{${r}}}`), r);
  assert.ok(validateTemplate(VALIDE.replace("{{consigne_relecteur}}", "")).some((x) => x.includes("{{consigne_relecteur}}")));
});

test("validation : le format de sortie ne se redéfinit pas", () => {
  for (const tentative of [
    "Réponds en JSON :",
    "Réponds uniquement en json avec ces champs",
    "Format de sortie : texte libre",
    '  "title": "..."',
    "{\n  title\n}",
    "```json",
  ]) {
    assert.ok(validateTemplate(`${VALIDE}\n${tentative}`).some((e) => /format de sortie est verrouillé/.test(e)), tentative);
  }
});

test("validation : vide, trop long, pas un texte", () => {
  assert.match(validateTemplate("  ")[0], /vide/);
  assert.match(validateTemplate(null)[0], /texte/);
  assert.ok(validateTemplate(VALIDE + "x".repeat(40000)).some((e) => /trop long/.test(e)));
});

/* --------------------------------------------------------------- résolution */

const marque = (m) => `${m}\n${DEFAULT_TEMPLATE}`;
const ROWS = [
  { id: "1", providerId: null, model: null, template: marque("GENERAL"), version: 3 },
  { id: "2", providerId: "or", model: null, template: marque("MOTEUR"), version: 1 },
  { id: "3", providerId: "or", model: "m/a", template: marque("MODELE"), version: 2 },
  { id: "4", providerId: "or", model: "m/b", template: null, version: 2 },
  { id: "5", providerId: "x", model: null, template: "{{inconnue}}", version: 1 },
];

test("résolution : (moteur, modèle) > (moteur) > général > défaut du code", () => {
  assert.deepEqual(pick(resolvePrompt(ROWS, "or", "m/a")), ["modele", "3", 2]);
  assert.deepEqual(pick(resolvePrompt(ROWS, "or", "m/b")), ["moteur", "2", 1], "surcharge du modèle supprimée → moteur");
  assert.deepEqual(pick(resolvePrompt(ROWS, "or", "m/z")), ["moteur", "2", 1]);
  assert.deepEqual(pick(resolvePrompt(ROWS, "autre", "m/a")), ["general", "1", 3]);
  assert.deepEqual(pick(resolvePrompt([], "or", "m/a")), ["defaut", null, null]);
  assert.equal(resolvePrompt([], "or").template, DEFAULT_TEMPLATE);
  assert.deepEqual(pick(resolvePrompt([{ ...ROWS[0], template: null }], "or", "m")), ["defaut", null, null], "général supprimé → code");
});
function pick(r) { return [r.scope, r.id, r.version]; }

test("résolution : un modèle invalide en base est sauté et signalé", () => {
  const r = resolvePrompt(ROWS, "x", "m");
  assert.equal(r.scope, "general");
  assert.equal(r.ignored.length, 1);
  assert.equal(r.ignored[0].id, "5");
});

/* ------------------------------------------------------------ couche LLM */

const OR = "https://openrouter.ai/api/v1";
const engine = (id, model = `${id}/model`) => ({ id, label: id.toUpperCase(), kind: "fake", baseUrl: OR, apiKey: "k", defaultModel: model, enabled: true });
const OK = { title: "Rochefort ouvre une médiathèque", chapo: "C.", body: [{ type: "p", text: "x".repeat(900) }],
  category: "Culture", suggested_ranking: 70, seo: { metaTitle: "Rochefort", metaDescription: "d".repeat(100), slug: "rochefort-mediatheque", keywords: ["a", "b", "c"] } };
const RULES = { rules_retry_max: 0, length_source_pct: 0 };

function fakeAdapter(behaviour, seen) {
  return {
    chat: async (provider, system, user, opts) => {
      seen.push({ id: provider.id, model: opts.model, user });
      const b = behaviour[`${provider.id}|${opts.model}`] ?? behaviour[provider.id];
      if (typeof b !== "function") throw new Error(`HTTP 503 (${provider.id})`);
      return b(system, user);
    },
  };
}

test("le prompt est construit par moteur : le secours reçoit SA surcharge", async () => {
  const seen = [];
  llm.__test.useEngines({
    primary: engine("principal"), fallback: engine("secours"),
    adapters: { fake: fakeAdapter({ secours: () => OK }, seen) },
    prompts: [
      { id: "10", providerId: null, model: null, template: marque("GENERAL"), version: 1 },
      { id: "11", providerId: "secours", model: null, template: marque("SECOURS"), version: 4 },
    ],
  });
  const gen = await llm.generateArticle(EXTRAITS, { rules: RULES });
  assert.deepEqual(seen.map((s) => s.id), ["principal", "secours"]);
  assert.ok(seen[0].user.startsWith("GENERAL\n"), "principal : prompt général");
  assert.ok(seen[1].user.startsWith("SECOURS\n"), "secours : sa surcharge");
  assert.ok(seen[1].user.endsWith(FORMAT_SORTIE));
  assert.deepEqual(gen.prompt, { scope: "moteur", id: "11", version: 4, provider: "secours", model: "secours/model" });
  assert.deepEqual(llm.llmStats.prompts, [{ ...gen.prompt, articles: 1 }]);
});

test("même moteur, autre modèle en secours : la surcharge du modèle s'applique au seul secours", async () => {
  const seen = [];
  const P = engine("or", "m/a");
  llm.__test.useEngines({
    primary: P, fallback: { ...P, defaultModel: "m/b" },
    adapters: { fake: fakeAdapter({ "or|m/b": () => OK }, seen) },
    prompts: [{ id: "20", providerId: "or", model: "m/b", template: marque("MODELE-B"), version: 1 }],
  });
  const gen = await llm.generateArticle(EXTRAITS, { rules: RULES });
  assert.deepEqual(seen.map((s) => s.model), ["m/a", "m/b"]);
  assert.equal(seen[0].user, userPrompt(EXTRAITS, { rules: RULES }), "principal : défaut du code, à l'octet");
  assert.ok(seen[1].user.startsWith("MODELE-B\n"));
  assert.equal(gen.prompt.scope, "modele");
});

test("modèle invalide en base : ignoré avec un avertissement, niveau supérieur", async () => {
  const seen = [];
  warnings.length = 0;
  llm.__test.useEngines({
    primary: engine("p"), adapters: { fake: fakeAdapter({ p: () => OK }, seen) },
    prompts: [{ id: "30", providerId: "p", model: null, template: "{{inconnue}}", version: 1 }],
  });
  const gen = await llm.generateArticle(EXTRAITS, { rules: RULES });
  assert.equal(seen[0].user, userPrompt(EXTRAITS, { rules: RULES }));
  assert.equal(gen.prompt.scope, "defaut");
  assert.ok(warnings.some((w) => /n° 30 .*ignoré/.test(w)));
});

test("repli mock : aucun prompt n'a servi", async () => {
  llm.__test.useEngines({ primary: null });
  const gen = await llm.generateArticle(EXTRAITS, { rules: RULES });
  assert.equal(gen.prompt, null);
});

test("base illisible : refreshProvider retombe sur le défaut du code, sans lever", async () => {
  warnings.length = 0;
  await llm.refreshProvider();   // DATABASE_URL absente : toute lecture échoue
  assert.ok(warnings.some((w) => /prompts de génération illisibles .*défaut du code/.test(w)));
  const seen = [];
  /* useEngines n'efface pas les prompts relus : on repose le moteur sans en injecter. */
  llm.__test.useEngines({ primary: engine("p"), adapters: { fake: fakeAdapter({ p: () => OK }, seen) } });
  const gen = await llm.generateArticle(EXTRAITS, { rules: RULES });
  assert.equal(gen.prompt.scope, "defaut");
});

test("aperçu : le jeu d'exemple se rend avec le défaut", () => {
  const p = userPrompt(EXEMPLE_EXTRAITS, { ...EXEMPLE_OPTIONS, template: DEFAULT_TEMPLATE });
  assert.ok(p.includes("Saintes"));
  assert.ok(p.includes("Consigne supplémentaire du relecteur : (exemple)"));
  assert.ok(!p.includes("{{"));
});
