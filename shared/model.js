/* Modèle métier partagé — importé par le backend Node ET par le navigateur.
   Servi tel quel sous /shared/model.js. Seule dépendance : les zones couvertes,
   elles aussi sous /shared/ et sans dépendance DOM. */

import { currentCoverage, regionCodeOf, regionCovered } from "./zones.js";
import { SLUG_MAX_WORDS } from "./slug.js";

/* Couleurs : le code garde le NOM du jeton, la couleur vit dans styles/base.css
   (bloc .cr, et sa variante [data-theme="dark"] .cr) — M3-106. `color` vaut
   "var(--status-…)" pour que les lecteurs (style inline côté client) suivent le
   thème sans changer. Aucun lecteur côté serveur n'a besoin d'un hex : si un jour
   un SVG, un e-mail ou un PDF en demande un, ajouter un champ `hex` dédié. */
const tok = (token) => ({ token, color: `var(--${token})` });
export const STATUSES = {
  brouillon: { label: "Brouillon", ...tok("status-brouillon") },
  a_revoir: { label: "À revoir", ...tok("status-a_revoir") },
  signale: { label: "Signalé", ...tok("status-signale") },
  valide: { label: "Validé", ...tok("status-valide") },
  publie: { label: "Publié", ...tok("status-publie") },
  archive: { label: "Archivé", ...tok("status-archive") },
};
export const STATUS_ORDER = ["brouillon", "a_revoir", "signale", "valide", "publie", "archive"];

export const FLAG_LABELS = {
  plagiat: "Risque de plagiat",
  hallucination: "Hallucination possible",
  doublon: "Doublon",
  hors_sujet: "Sujet non local",
  date_suspecte: "Date à vérifier",
  contenu_partenaire: "Contenu de partenaire",
  citation_a_verifier: "Citation à vérifier",
  regles_non_tenues: "Règles non tenues",          // M3-87
  relecture_llm: "Relecture LLM : à rejeter",      // M3-89
};

export const ROLES = {
  administrateur: "Administrateur",
  super_utilisateur: "Super Utilisateur",
  relecteur: "Utilisateur-Relecteur",
};

/* Ordre des rôles, du moins au plus large. PERMISSIONS dit QUI peut QUOI, droit
   par droit ; ce rang ne sert qu'aux réglages exprimés en seuil (« visible à
   partir de tel rôle »), où comparer deux rôles a un sens. Ne pas s'en servir
   pour décider d'un droit : c'est PERMISSIONS qui fait foi, et un rôle plus haut
   n'a pas forcément tous les droits d'un rôle plus bas. */
export const ROLE_RANK = { relecteur: 0, super_utilisateur: 1, administrateur: 2 };
export const roleAtLeast = (role, seuil) => (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[seuil] ?? 0);

/* Table des droits (preREADME §Authentification). */
export const PERMISSIONS = {
  administrateur: {
    backoffice: true, frontoffice: true, manage_users: true, manage_sources: true,
    generate_review: true, view_stats: true, publish: true, manage_settings: true,
    manage_competitors: true,
  },
  super_utilisateur: {
    backoffice: false, frontoffice: true, manage_users: false, manage_sources: false,
    generate_review: true, view_stats: true, publish: true, manage_settings: false,
    /* M3-120 (décision de l'utilisateur du 2026-10-27) : le superutilisateur suit les
       sites concurrents (Sources → Concurrents) sans autre accès au back-office. */
    manage_competitors: true,
  },
  relecteur: {
    backoffice: false, frontoffice: true, manage_users: false, manage_sources: false,
    generate_review: true, view_stats: false, publish: true, manage_settings: false,
    manage_competitors: false,
  },
};

export function can(role, perm) {
  return !!(PERMISSIONS[role] && PERMISSIONS[role][perm]);
}

/* Rubriques éditoriales (reprises de la console). */
/* Même règle que STATUSES : `c` et `tint` valent var(--rub-<slug>) et
   var(--rub-<slug>-tint), posés par les écrans dans --cc / --cc-tint. Le champ
   `illo` (deux hex de dégradé d'illustration) a été retiré en M3-106 : plus aucun
   lecteur, ni en CSS ni en JS, depuis le portage Next. */
const rub = (slug) => ({ token: `rub-${slug}`, c: `var(--rub-${slug})`, tint: `var(--rub-${slug}-tint)` });
export const CAT = {
  "Économie": rub("economie"),
  "Culture": rub("culture"),
  "Environnement": rub("environnement"),
  "Société": rub("societe"),
  "Sport": rub("sport"),
};
/* Rubrique inconnue : couleurs de la marque, comme avant (l'ancien repli valait
   les hex de --brand / --brand-tint). */
const CAT_DEFAUT = { token: "brand", c: "var(--brand)", tint: "var(--brand-tint)" };
export function catInfo(name) {
  return CAT[name] || CAT_DEFAUT;
}

/* Article écrit par le générateur de secours (src/llm/mock.js), et non par un LLM :
   moteur réglé sur « mock », LLM injoignable, ou plafond de dépense en action
   « mock ». Le texte assemble des phrases de la source sous des intertitres codés
   en dur — il peut cocher les cinq critères sans être un article (M3-84). Il ne
   part donc pas en parution : il se régénère. */
export const writtenByMock = (a) => a?.provider === "mock";

/* Une illustration n'existe que si elle a une URL (M3-93). Une case ajoutée
   jamais remplie cochait le critère « Illustration » sans image à publier, et
   contredisait le refus de parution. Lu par la grille (scoring.js) ET par la
   FEAT « Parution sans illustration » (feats.js) : une seule définition. */
export const hasImage = (a) => !!String(a?.illustration?.url || "").trim();
/* Crédit de l'illustration (M3-113, décision 6) : exigé avec l'URL par le critère
   « Illustration » de la grille. hasImage reste seul pour la FEAT M3-93. */
export const hasCredit = (a) => !!String(a?.illustration?.credit || "").trim();
export const MOCK_PUBLISH_REFUSAL = "Texte produit sans LLM (générateur de secours) : renvoyez-le à l'IA avant de l'envoyer en parution.";

/* Libellé de l'état de l'article dans la barre d'actions. Calculé au rendu ET à
   chaque frappe (scripts/refresh.js) : un seul endroit, sinon un texte du mock
   redevient « prêt » dès qu'on corrige une virgule. */
export function readyTitle(a, A) {
  if (writtenByMock(a)) return "Texte de remplissage — à renvoyer à l'IA";
  const miss = A.total - A.passed;
  return A.ready ? "Prêt pour la parution" : `${miss} point${miss > 1 ? "s" : ""} du cahier des charges à contrôler`;
}

/* Zones géographiques. "hab" = zone habilitée : un département COUVERT, réglé au
   back-office (zones_covered, shared/zones.js — M3-74). Le périmètre était codé
   en dur sur la Nouvelle-Aquitaine, avec un troisième état « limitrophe » que rien
   n'exploitait ; un département est désormais couvert, ou il ne l'est pas. */
/* n° → nom des 12 départements de Nouvelle-Aquitaine. */
export const NA_DEPT_NAMES = {
  "16": "Charente", "17": "Charente-Maritime", "19": "Corrèze", "23": "Creuse",
  "24": "Dordogne", "33": "Gironde", "40": "Landes", "47": "Lot-et-Garonne",
  "64": "Pyrénées-Atlantiques", "79": "Deux-Sèvres", "86": "Vienne", "87": "Haute-Vienne",
};
export function zoneOf(num, covered = currentCoverage()) {
  return covered.includes(String(num)) ? "hab" : "nonhab";
}

/* Classe d'une zone à partir de l'objet complet. `num` vaut un n° de département,
   "NA" pour une publication à portée régionale (le nom est historique : la région
   est dans `region`), ou "HS" hors périmètre.
   - un département : habilité s'il est couvert — même si l'article a été marqué
     `outsideNA` sous une couverture antérieure : c'est le département qui fait foi ;
   - "HS", ou `outsideNA` sans département : non habilité ;
   - portée régionale : habilitée si la région compte au moins un département
     couvert, puisque le sujet le concerne aussi. */
export function zoneClassOf(zone, covered = currentCoverage()) {
  const z = zone || {};
  const n = z.num == null ? "" : String(z.num);
  if (n && n !== "NA" && n !== "HS") return zoneOf(n, covered);
  if (n === "HS" || z.outsideNA) return "nonhab";
  const r = regionCodeOf(z.region);
  return r && regionCovered(r, covered) ? "hab" : "nonhab";
}
/* Libellé court d'une zone (commune, département, ou portée régionale). */
export function zoneLabel(zone) {
  const z = zone || {};
  if (z.commune && z.dept && z.commune !== z.dept) return `${z.commune} (${z.dept})`;
  if (z.dept) return z.dept;
  if (z.commune) return z.commune;
  if (z.num === "NA" || z.regionOnly) return "Toute la région";
  if (z.num === "HS") return "Hors périmètre";
  return "—";
}

/* ------------------------------------------------------- corps en blocs (2026-09-17)

   Le corps était un tableau de chaînes, toutes rendues en <p>. Le plan Hn vivait
   à côté, dans seo.outline, sans jamais toucher le texte : on tenait un plan pour
   un article qui n'avait pas d'intertitres. Le corps porte désormais sa propre
   structure, et le plan n'est plus qu'une vue sur lui.

   Un bloc : { id, type: "p" | "h2" | "h3", text }.

   asBlocks() accepte encore l'ancien format. Ce n'est pas de la complaisance :
   la migration 007 convertit la base, mais un document restauré d'une sauvegarde
   antérieure, ou un LLM qui répond à l'ancienne forme, arriverait sinon vide. */

export const BLOCK_TYPES = ["p", "h2", "h3"];

export function newBlockId() {
  const rnd = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return "b" + rnd;
}

export function asBlocks(body) {
  if (!Array.isArray(body)) return [];
  return body
    .map((b) => {
      if (typeof b === "string") return { id: newBlockId(), type: "p", text: b };
      if (!b || typeof b !== "object") return null;
      const type = BLOCK_TYPES.includes(b.type) ? b.type : "p";
      return { id: b.id || newBlockId(), type, text: String(b.text ?? "") };
    })
    /* Les blocs vides sont conservés : « Ajouter un paragraphe » en crée un, et
       les filtrer ici le ferait disparaître sous les doigts du relecteur.
       L'élagage a lieu une fois, à la génération (finalize.js). */
    .filter(Boolean);
}

export function isHeading(b) { return b && b.type !== "p"; }

/* Texte brut du corps — anti-plagiat, régénération, empreintes de doublon.
   Remplace les `body.join("\n")` d'avant, qui ne compilent plus. */
export function plainText(article) {
  return asBlocks(article?.body).map((b) => b.text).join("\n");
}

/* Le plan Hn, dérivé du corps. Le H1 n'est pas un bloc : c'est le titre de
   l'article, et il n'y en a donc jamais deux. `ref` désigne ce qu'édite la
   ligne — "title", ou l'identifiant du bloc. */
export function outlineOf(article) {
  const rows = [{ t: "H1", x: String(article?.title || ""), ref: "title" }];
  for (const b of asBlocks(article?.body)) {
    if (isHeading(b)) rows.push({ t: b.type.toUpperCase(), x: b.text, ref: b.id });
  }
  return rows;
}

/* Réinjecte un plan hérité (seo.outline) dans un corps qui n'a pas d'intertitre,
   en répartissant les intertitres à intervalles réguliers entre les paragraphes.
   Le placement est une approximation assumée — la seule information disponible
   est l'ordre du plan. Sert à la migration du stock et au repli quand un LLM
   répond encore avec un plan séparé. Ne fait rien si le corps est déjà structuré. */
export function foldOutlineIntoBody(body, outline) {
  const blocks = asBlocks(body);
  if (blocks.some(isHeading)) return blocks;

  const heads = (Array.isArray(outline) ? outline : [])
    .filter((o) => o && o.t !== "H1" && String(o.x || "").trim())
    .map((o) => ({ id: newBlockId(), type: o.t === "H3" ? "h3" : "h2", text: String(o.x).trim() }));
  if (heads.length === 0) return blocks;

  /* Un intertitre a besoin d'au moins un paragraphe sous lui, et le premier
     paragraphe reste en chapeau : au-delà de n-1 intertitres, on tronque plutôt
     que d'empiler des titres sans corps. */
  const usable = heads.slice(0, Math.max(0, blocks.length - 1));
  if (usable.length === 0) return blocks;

  const out = [];
  const step = blocks.length / (usable.length + 1);
  let next = 0;
  blocks.forEach((b, i) => {
    if (next < usable.length && i >= Math.round((next + 1) * step)) out.push(usable[next++]);
    out.push(b);
  });
  while (next < usable.length) out.push(usable[next++]);
  return out;
}

const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/* Rend le corps en HTML — c'est cette chaîne que le publisher envoie. Tant que
   le corps était plat, l'article publié était une suite de <p> sans hiérarchie,
   quel que soit le plan affiché en console. */
export function bodyHtml(article) {
  return asBlocks(article?.body)
    .map((b) => {
      const t = b.text.replace(/[&<>"]/g, (c) => HTML_ESC[c]);
      return b.type === "p" ? `<p>${t}</p>` : `<${b.type}>${t}</${b.type}>`;
    })
    .join("\n");
}

/* Au-delà de cette longueur (en signes), un article doit porter au moins un
   intertitre ; en deçà, c'est une brève, qui n'en a pas besoin. Une seule valeur,
   lue par le prompt de génération (src/llm/prompts/generate.js) ET par le critère
   SEO (shared/scoring.js) : jusqu'au 2026-10-12, le prompt disait « au-delà de
   1 500 signes » et la grille exigeait un H2 partout, si bien qu'une brève fidèle
   à sa consigne échouait au SEO pour une structure qu'elle ne pouvait pas avoir.
   Réglable au back-office depuis le 2026-10-12 (`h2_above_signs`) : le prompt lit
   désormais les réglages, il ne peut plus citer une valeur que la grille ne suit
   pas. Cette constante n'est plus que la valeur par défaut. */
export const H2_REQUIRED_ABOVE_SIGNS = 1500;

/* Règles que seul le prompt de génération cite — la grille ne les contrôle pas.
   Réglables dans l'onglet Paramètres, comme celles de la grille. */
export const PROMPT_DEFAULTS = {
  title_max: 90,          // titre de l'article, en caractères
  h2_title_max: 70,       // longueur d'un intertitre, en caractères
  breve_signs_min: 600,   // plancher d'une brève (et de tout article), en signes
};

/* Défauts des règles de longueur (M3-86) et des règles contrôlées après
   génération — déplacés de src/llm/lengthTarget.js et src/llm/rules.js au lot 2
   du découpage (T18), pour que le registre des réglages (src/lib/yamlStore.js)
   les lise sans importer le moteur. Les deux modules les réexportent. */
export const LENGTH_DEFAULTS = Object.freeze({
  /* 100 % : un article de la longueur de la matière utile de la source. 0
     désactive la règle — le prompt reprend alors la consigne « proportionnée »
     d'avant M3-86, mot pour mot. */
  length_source_pct: 100,

  /* Titres et méta (M3-86, même logique que le corps). Les minimums n'ont d'effet
     que si le pourcentage est > 0 : à 0 — défaut — la règle reste « ≤ max »
     (title_max, meta_title_max) et « entre meta_desc_min et meta_desc_max »,
     à l'octet près. Le titre de la source règle le titre ET la balise titre ;
     le chapô de la source règle la méta-description. */
  title_min: 30,
  meta_title_min: 30,
  title_source_pct: 0,
  meta_source_pct: 0,
});

export const RULES_DEFAULTS = Object.freeze({
  rules_retry_max: 1,
  /* Slug : 6 mots au plus (décision du 2026-10-15). 0 = sans limite ; les mots
     vides et les dates, eux, sont toujours écartés. */
  slug_max_words: SLUG_MAX_WORDS,
});

/* Valeurs de scoring par défaut (surchargées par config/settings.yml côté backend).
   M3-113 : `signs_min` est supprimé (décision 1) ; sans fenêtre `checks.length`, la
   grille retombe sur `breve_signs_min`, le plancher de la génération. Les clés lues
   par la grille sont toutes ici : /api/me n'envoie aux écrans que celles-ci. */
export const DEFAULT_SETTINGS = {
  breve_signs_min: PROMPT_DEFAULTS.breve_signs_min,
  signs_max: 7000,
  ranking_threshold: 60,
  meta_title_max: 60,
  meta_desc_min: 70,
  meta_desc_max: 160,
  keywords_min: 3,
  signs_per_minute: 1400,
  outline_h2_min: 1,
  h2_above_signs: H2_REQUIRED_ABOVE_SIGNS,
  slug_max_words: SLUG_MAX_WORDS,   // slug : mots au plus, 0 = sans limite (shared/slug.js)
};
