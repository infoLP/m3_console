/* Modèle du prompt de génération, modifiable au back-office (M3-56).

   Pur : ni base, ni réseau. Il sert au serveur (génération, validation à
   l'enregistrement, aperçu) comme à l'écran (validation pendant la saisie).

   TROIS VERROUS, posés ici et pas dans l'écran :
   1. LISTE FERMÉE DE VARIABLES. Un modèle ne peut citer que les variables de
      `PROMPT_VARIABLES`, écrites `{{nom}}`. Chacune est calculée par le code
      (src/llm/prompts/generate.js, `variablesDe`) à partir des réglages : les
      chiffres que le contrôle après génération vérifie restent donc ceux que le
      prompt annonce, quel que soit le texte écrit autour.
   2. VARIABLES INDISPENSABLES (`REQUIRED_VARIABLES`) : la matière à rédiger, la
      consigne du relecteur et chaque règle dont l'écart fait REDEMANDER
      l'article (checkRules, `retry` vrai). Les retirer du prompt, c'est payer
      des relances pour des règles que le modèle n'a jamais lues — le désaccord
      prompt / grille du 2026-10-12, réintroduit à la main.
   3. FORMAT DE SORTIE VERROUILLÉ. Le bloc « Réponds en JSON » (`FORMAT_SORTIE`)
      n'est jamais dans le modèle : le code l'ajoute toujours après. Un modèle
      qui tente de le redéfinir est refusé — sinon `normalizeGenerated` recevrait
      des champs qu'il ne sait pas lire, et l'article partirait vide. */

/* Ordre = ordre d'affichage à l'écran. `requise` : voir REQUIRED_VARIABLES.
   `exemple` : valeur pour l'article d'exemple de l'aperçu (EXEMPLE_EXTRAITS,
   réglages par défaut), abrégée « … » quand elle est longue, vide quand la
   variable l'est pour cet article. Affichage seul (M3-111) : ni renderTemplate
   ni variablesDe ne le lisent, il ne change rien au prompt envoyé. */
export const PROMPT_VARIABLES = Object.freeze([
  { nom: "consigne_mode", description: "Consigne du mode : réécriture d'un article de presse (contenu original, pas de plagiat) ou rédaction depuis une source officielle.", exemple: "Mode : rédaction à partir d'une source officielle (communiqué / institution). Traduis l'information en article journalistique." },
  { nom: "zone", description: "Zone couverte par le média (sert à juger l'intérêt local, jamais à écrire).", exemple: "Charente-Maritime" },
  { nom: "date_source", description: "Date de publication de la source en clair (« 29 septembre 2026 ») ; vide si inconnue.", exemple: "1 octobre 2026" },
  { nom: "phrase_date_source", description: "« Source publiée le … » suivi d'un retour à la ligne ; vide si la date est inconnue.", exemple: "Source publiée le 1 octobre 2026." },
  { nom: "phrase_partenariat", description: "Consigne « contenu de partenariat, dis-le » suivie d'un retour à la ligne ; vide pour une source ordinaire.", exemple: "" },
  { nom: "consigne_relecteur", description: "« Consigne supplémentaire du relecteur : … » (régénération) ; vide sans consigne.", exemple: "Consigne supplémentaire du relecteur : préciser les horaires dès le chapô." },
  { nom: "elements_extraits", description: "Éléments extraits de la source (faits, citations, entités…), en JSON indenté.", exemple: "{ \"title_hint\": \"La médiathèque de Saintes ouvre le dimanche\", \"facts\": [ … ], \"quotes\": [ … ] }" },
  { nom: "regle_titre", description: "Longueur du titre : cible tirée du titre de la source, ou borne des Paramètres (« ≤ 90 caractères »).", exemple: "≤ 90 caractères" },
  { nom: "rubriques", description: "Les rubriques possibles, séparées par des virgules.", exemple: "Économie, Culture, Environnement, Société, Sport" },
  { nom: "regle_longueur", description: "Puce complète de la consigne de longueur du corps (cible calculée sur la source, ou bornes des Paramètres).", exemple: "- LONGUEUR IMPÉRATIVE du corps : environ 2 400 signes, et JAMAIS moins de 1 920 ni plus de 2 880 signes…" },
  { nom: "grille_ranking", description: "Puce complète du barème de ranking (intérêt pour le lecteur de la zone).", exemple: "- RANKING (suggested_ranking) : l'intérêt pour un lecteur de la zone couverte… Barème : 80-100 : fait local nouveau et concret…" },
  { nom: "regle_h2", description: "Seuil et nombre minimal d'intertitres h2 (« Au-delà de 1 500 signes, place au moins un h2 ; un h2 tous les 2 à 4 »).", exemple: "Au-delà de 1 500 signes, place au moins un h2 ; un h2 tous les 2 à 4" },
  { nom: "intertitre_max", description: "Longueur maximale d'un intertitre, en caractères (nombre seul).", exemple: "70" },
  { nom: "regle_balise_titre", description: "Longueur de la balise titre : cible tirée du titre de la source, ou borne des Paramètres (« ≤ 60 caractères »).", exemple: "≤ 60 caractères" },
  { nom: "regle_meta", description: "Longueur de la méta-description : cible tirée du chapô de la source, ou bornes des Paramètres (« entre 70 et 160 caractères »).", exemple: "entre 70 et 160 caractères" },
  { nom: "regle_slug", description: "Phrase complète de la règle du slug (« Slug : 6 mots au plus, en minuscules… »).", exemple: "Slug : 6 mots au plus, en minuscules, séparés par des tirets, sans accent, sans mot vide (le, de, à…) ni date." },
  { nom: "mots_cles_min", description: "Nombre minimal de mots-clés (nombre seul).", exemple: "3" },
].map((v) => Object.freeze(v)));

/* Indispensables : la matière (sans elle le modèle invente), la consigne du
   relecteur (sans elle, une régénération demandée par un humain l'ignorerait
   en silence), et chaque règle BLOQUANTE de checkRules (src/llm/rules.js) :
   titre, longueur, nombre de h2, longueur d'intertitre, méta-description,
   mots-clés. Balise titre et slug sont contrôlés sans relance (`retry: false`) :
   recommandés, pas exigés. */
export const REQUIRED_VARIABLES = Object.freeze([
  "elements_extraits", "regle_longueur", "consigne_relecteur",
  "regle_titre", "regle_h2", "intertitre_max", "regle_meta", "mots_cles_min",
]);

const NAMES = new Set(PROMPT_VARIABLES.map((v) => v.nom));

/* Au-delà, ce n'est plus un prompt mais un document : le coût part à chaque
   appel, relances comprises. */
export const TEMPLATE_MAX = 30000;

/* Ajouté par le code après tout modèle, général ou surchargé. Commence par la
   ligne vide qui le séparait des contraintes dans le prompt d'origine. */
export const FORMAT_SORTIE = `

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

/* Le prompt général d'avant M3-56, mot pour mot, ses parties calculées
   remplacées par des variables : rendu avec `variablesDe` puis suivi de
   FORMAT_SORTIE, il redonne le texte d'avant à l'octet près
   (test/promptTemplate.test.js). */
export const DEFAULT_TEMPLATE = `{{consigne_mode}}
Zone couverte par le média : {{zone}}. Elle sert UNIQUEMENT à juger l'intérêt
local (ranking). N'écris JAMAIS que le sujet concerne cette zone, ni aucun lieu, si les éléments
extraits ne le disent pas.
{{phrase_date_source}}{{phrase_partenariat}}{{consigne_relecteur}}

ÉLÉMENTS EXTRAITS :
{{elements_extraits}}

Contraintes :
- TITRE : une vraie accroche de presse, avec un verbe, {{regle_titre}}. JAMAIS
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
{{regle_longueur}}
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
{{grille_ranking}}
- STRUCTURE : le corps est une suite de blocs typés. « p » = paragraphe,
  « h2 » = intertitre, « h3 » = sous-intertitre d'un h2 qui précède.
  {{regle_h2}}
  paragraphes environ. Une BRÈVE courte n'a pas besoin d'intertitre.
  Un intertitre est court (≤ {{intertitre_max}} caractères), informatif, sans point final,
  et il est TOUJOURS suivi d'au moins un paragraphe.
  N'émets JAMAIS de h1 : le titre de l'article est le seul H1.
- Balise titre {{regle_balise_titre}}, méta-description {{regle_meta}}.
- {{regle_slug}}
- Au moins {{mots_cles_min}} mots-clés.
- Les limites chiffrées ci-dessus (titre, intertitres, longueur, balise titre,
  méta-description, mots-clés) sont IMPÉRATIVES : ta réponse est contrôlée
  automatiquement, et rejetée si une seule n'est pas tenue. Compte avant de répondre.`;

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const NAME_RE = /^[a-z][a-z0-9_]*$/;

/* Remplace chaque `{{nom}}` connu de `vars` par sa valeur, en UNE passe : une
   valeur qui contient elle-même `{{…}}` (un extrait de source) n'est pas
   réinterprétée. Une variable absente de `vars` est laissée telle quelle :
   validateTemplate l'a déjà signalée. */
export function renderTemplate(template, vars = {}) {
  return String(template ?? "").replace(TOKEN, (m, nom) => (
    Object.hasOwn(vars, nom) ? String(vars[nom] ?? "") : m
  ));
}

/* Ce qui ressemble à une redéfinition du format de sortie. Les marques du JSON
   de réponse (clé entre guillemets suivie de « : », ligne faite d'une seule
   accolade ou d'un crochet, bloc de code) et les consignes de forme de la
   réponse. Le prompt par défaut n'en contient aucune. */
const FORMAT_PATTERNS = [
  { re: /r[ée]pon(?:ds|dez|se)\b[^\n.]{0,60}\bjson\b/i, quoi: "une consigne de réponse en JSON" },
  { re: /\bjson\s*:/i, quoi: "une annonce de JSON" },
  { re: /\bformat\s+(?:de\s+)?(?:la\s+)?(?:sortie|r[ée]ponse)\b/i, quoi: "une consigne de format de sortie" },
  { re: /"[A-Za-z_][\w-]*"\s*:/, quoi: "une clé JSON (\"…\" :)" },
  { re: /^\s*[{}[\]]\s*,?\s*$/m, quoi: "une ligne de structure JSON ({, }, [ ou ])" },
  { re: /```/, quoi: "un bloc de code (```)" },
];

/* → liste d'erreurs en français, vide si le modèle est utilisable. */
export function validateTemplate(template) {
  if (typeof template !== "string") return ["le modèle doit être un texte"];
  const errors = [];
  if (!template.trim()) return ["le modèle est vide (pour revenir au niveau supérieur, supprimer la surcharge)"];
  if (template.length > TEMPLATE_MAX) errors.push(`modèle trop long : ${template.length} caractères, ${TEMPLATE_MAX} au plus`);

  const used = new Set();
  const unknown = new Set();
  const invalid = new Set();
  for (const [, raw] of template.matchAll(TOKEN)) {
    if (!NAME_RE.test(raw)) invalid.add(raw);
    else if (!NAMES.has(raw)) unknown.add(raw);
    else used.add(raw);
  }
  for (const n of invalid) errors.push(`nom de variable invalide : {{${n}}} (minuscules, chiffres et _ seulement)`);
  for (const n of unknown) errors.push(`variable inconnue : {{${n}}}`);

  const rest = template.replace(TOKEN, "");
  if (rest.includes("{{")) errors.push("accolades mal formées : « {{ » sans « }} » correspondant");
  if (rest.includes("}}")) errors.push("accolades mal formées : « }} » sans « {{ » correspondant");
  const single = rest.match(/(?<!\{)\{\s*([a-z][a-z0-9_]*)\s*\}(?!\})/);
  if (single) errors.push(`accolades simples : {${single[1]}} — une variable s'écrit {{${single[1]}}}`);

  const missing = REQUIRED_VARIABLES.filter((n) => !used.has(n));
  if (missing.length) errors.push(`variable${missing.length > 1 ? "s" : ""} indispensable${missing.length > 1 ? "s" : ""} absente${missing.length > 1 ? "s" : ""} : ${missing.map((n) => `{{${n}}}`).join(", ")}`);

  for (const { re, quoi } of FORMAT_PATTERNS) {
    if (re.test(rest)) errors.push(`le format de sortie est verrouillé et ajouté par le code : retirer ${quoi}`);
  }
  return errors;
}

/* Choix du modèle pour un appel. `rows` : la version COURANTE de chaque
   (providerId, model) — `template` null = surcharge supprimée.
   Priorité : (moteur, modèle) > (moteur, tout modèle) > général > défaut du code.
   Un modèle en base qui ne passe plus la validation (variable retirée depuis,
   par exemple) est ignoré et signalé dans `ignored` : on passe au niveau
   supérieur plutôt que d'envoyer un prompt cassé. */
/**
 * @param {Array<{ id?: string|null, providerId?: string|null, model?: string|null, template?: string|null, version?: number|null }>} rows
 * @param {string|null} [providerId]
 * @param {string|null} [model]
 */
export function resolvePrompt(rows, providerId = null, model = null) {
  const list = Array.isArray(rows) ? rows : [];
  const m = String(model ?? "").trim() || null;
  const p = String(providerId ?? "").trim() || null;
  const levels = [];
  if (p && m) levels.push({ scope: "modele", providerId: p, model: m });
  if (p) levels.push({ scope: "moteur", providerId: p, model: null });
  levels.push({ scope: "general", providerId: null, model: null });
  const ignored = [];
  for (const lv of levels) {
    const row = list.find((r) => (r.providerId ?? null) === lv.providerId && (r.model ?? null) === lv.model);
    if (!row || row.template == null) continue;
    const errors = validateTemplate(row.template);
    if (errors.length) { ignored.push({ scope: lv.scope, id: row.id ?? null, errors }); continue; }
    return { template: row.template, scope: lv.scope, id: row.id ?? null, version: row.version ?? null, providerId: lv.providerId, model: lv.model, ignored };
  }
  return { template: DEFAULT_TEMPLATE, scope: "defaut", id: null, version: null, providerId: null, model: null, ignored };
}

/* Jeu d'exemple pour l'aperçu du back-office : aucun appel au LLM, seulement le
   rendu de ce que le modèle recevrait. */
export const EXEMPLE_EXTRAITS = Object.freeze({
  title_hint: "La médiathèque de Saintes ouvre le dimanche",
  facts: [
    "La médiathèque François-Mitterrand de Saintes ouvrira le dimanche de 14 h à 18 h à partir du 2 novembre 2026.",
    "L'ouverture dominicale est financée par l'État pour trois ans.",
  ],
  quotes: [{ text: "Nous voulons que la médiathèque soit ouverte quand les familles sont disponibles.", author: "Marie Dupont", role: "adjointe à la culture" }],
  entities: ["Saintes", "Médiathèque François-Mitterrand"],
  locality: "Saintes",
  angle: "Nouveaux horaires d'un service public",
  suggested_category: "Culture",
  /* Mesures de la source (corps, titre, chapô) : retirées avant envoi au
     modèle, elles donnent à l'aperçu de vraies cibles de longueur. */
  source_signs: 2400,
  source_title_chars: 44,
  source_lead_chars: 180,
});
export const EXEMPLE_OPTIONS = Object.freeze({
  mode: "official",
  region: "Charente-Maritime",
  publishedAt: "2026-10-01T09:00:00Z",
  partner: false,
  altPrompt: "(exemple) préciser les horaires dès le chapô.",
});
