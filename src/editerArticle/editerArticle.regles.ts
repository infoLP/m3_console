// Règles pures de l'édition : une saisie devient (article modifié, patch à
// envoyer). Porté de legacy/scripts/edit.js, sans DOM : le corps est une liste
// de blocs typés, manipulés par identifiant et jamais par rang.

import { asBlocks, newBlockId, zoneClassOf } from "@shared/model.js";
import { analyze, rankBand, wordsOf, readingOf } from "@shared/scoring.js";
import type { Article, Bloc, Scores } from "@/relireArticles/relireArticles.regles";

/* Contrôle de l'adresse d'illustration (M3-66), pour le champ « Image » : un
   composant ne lit pas src/publish/ directement. */
export { checkIllustrationUrl } from "@shared/illustrationUrl.js";

export type Patch = Record<string, unknown>;
export interface Modification { article: Article; patch: Patch; valeurAffichee?: string }

export const blocs = (a: Article): Bloc[] => asBlocks(a.body) as Bloc[];
const avecBlocs = (a: Article, body: Bloc[]): Article => ({ ...a, body });
const patchBody = (body: Bloc[]): Patch => ({ body: body.map((b) => ({ ...b })) });

/* Les champs contenteditable du texte : titre, chapô, signature, un bloc. */
export function editerTexte(a: Article, champ: string, valeur: string): Modification | null {
  if (champ === "title") return { article: { ...a, title: valeur }, patch: { title: valeur } };
  if (champ === "chapo") return { article: { ...a, chapo: valeur }, patch: { chapo: valeur } };
  if (champ === "signature") return { article: { ...a, signature: valeur }, patch: { signature: valeur } };
  if (champ.startsWith("block:")) {
    const id = champ.slice(6);
    const body = blocs(a).map((b) => (b.id === id ? { ...b, text: valeur } : b));
    return { article: avecBlocs(a, body), patch: patchBody(body) };
  }
  return null;
}

/* Les champs de la colonne de droite (data-in). `valeurAffichee` : la valeur
   nettoyée à remettre dans le champ (slug, numéro de département). */
export function editerChamp(a: Article, champ: string, v: string): Modification | null {
  const seo = { ...a.seo };
  if (champ === "mt") { seo.metaTitle = v; return { article: { ...a, seo }, patch: { seo: { metaTitle: v } } }; }
  if (champ === "md") { seo.metaDescription = v; return { article: { ...a, seo }, patch: { seo: { metaDescription: v } } }; }
  if (champ === "slug") {
    const nv = v.replace(/\s+/g, "-").toLowerCase();
    seo.slug = nv;
    return { article: { ...a, seo }, patch: { seo: { slug: nv } }, valeurAffichee: nv };
  }
  if (champ === "rank") {
    let n = parseInt(v, 10); if (isNaN(n)) n = 0; n = Math.max(0, Math.min(100, n));
    return { article: { ...a, ranking: n }, patch: { ranking: n } };
  }
  if (champ === "rankwhy") return { article: { ...a, rankingReason: v }, patch: { rankingReason: v } };
  if (champ === "srclabel") { if (!a.source) return null; return { article: { ...a, source: { ...a.source, label: v } }, patch: { source: { label: v } } }; }
  if (champ === "srcurl") { if (!a.source) return null; return { article: { ...a, source: { ...a.source, url: v } }, patch: { source: { url: v } } }; }
  if (champ === "illourl") { const ill = { credit: a.illustration?.credit || "", url: v }; return { article: { ...a, illustration: ill }, patch: { illustration: { url: v } } }; }
  if (champ === "illocredit") { const ill = { url: a.illustration?.url || "", credit: v }; return { article: { ...a, illustration: ill }, patch: { illustration: { credit: v } } }; }
  if (champ === "dept") return { article: { ...a, zone: { ...a.zone, dept: v } }, patch: { zone: { dept: v } } };
  if (champ === "num") {
    const nn = v.replace(/\D/g, "").slice(0, 3);
    const zone = { ...a.zone, num: nn };
    return { article: { ...a, zone, zoneClass: zoneClassOf(zone) as string }, patch: { zone: { num: nn } }, valeurAffichee: nn };
  }
  if (champ === "region") return { article: { ...a, zone: { ...a.zone, region: v } }, patch: { zone: { region: v } } };
  if (champ.startsWith("ol:")) {
    const ref = champ.slice(3);
    if (ref === "title") return { article: { ...a, title: v }, patch: { title: v } };
    return editerTexte(a, `block:${ref}`, v);
  }
  return null;
}

/* Les listes déroulantes (data-sel) : enregistrées tout de suite. */
export function choisir(a: Article, champ: string, v: string): Modification | null {
  if (champ === "cat") return { article: { ...a, cat: v }, patch: { cat: v } };
  if (champ === "srctype") {
    const source = a.source ? { ...a.source, type: v } : { type: v, label: "", url: "" };
    return { article: { ...a, source }, patch: { source: { type: v } } };
  }
  if (champ.startsWith("ollevel:")) {
    const id = champ.slice(8);
    const body = blocs(a).map((b) => (b.id === id ? { ...b, type: v.toLowerCase() } : b));
    return { article: avecBlocs(a, body), patch: patchBody(body) };
  }
  return null;
}

/* Actions structurelles : enregistrées tout de suite. */
export const structure = {
  blockAdd(a: Article, type: string): Modification {
    const body = [...blocs(a), { id: newBlockId() as string, type: type === "h2" || type === "h3" ? type : "p", text: "" }];
    return { article: avecBlocs(a, body), patch: patchBody(body) };
  },
  blockDel(a: Article, id: string): Modification | null {
    const arr = blocs(a);
    if (!arr.some((b) => b.id === id)) return null;
    let body = arr.filter((b) => b.id !== id);
    /* Un corps vide n'est pas un état atteignable. */
    if (body.length === 0) body = [{ id: newBlockId() as string, type: "p", text: "" }];
    return { article: avecBlocs(a, body), patch: patchBody(body) };
  },
  blockType(a: Article, id: string, type: string): Modification | null {
    const b = blocs(a).find((x) => x.id === id);
    if (!b || b.type === type) return null;
    const body = blocs(a).map((x) => (x.id === id ? { ...x, type } : x));
    return { article: avecBlocs(a, body), patch: patchBody(body) };
  },
  kwAdd(a: Article, brut: string): Modification | null {
    const v = (brut || "").trim().toLowerCase();
    const kws = a.seo.keywords || [];
    if (!v || kws.includes(v)) return null;
    const keywords = [...kws, v];
    return { article: { ...a, seo: { ...a.seo, keywords } }, patch: { seo: { keywords: keywords.slice() } } };
  },
  kwRemove(a: Article, k: string): Modification {
    const keywords = (a.seo.keywords || []).filter((x) => x !== k);
    return { article: { ...a, seo: { ...a.seo, keywords } }, patch: { seo: { keywords: keywords.slice() } } };
  },
  illoAdd(a: Article): Modification { const illustration = { credit: "", url: "" }; return { article: { ...a, illustration }, patch: { illustration } }; },
  illoDel(a: Article): Modification { return { article: { ...a, illustration: null }, patch: { illustration: null } }; },
};

/* Les patchs en attente se cumulent jusqu'à l'envoi. Les objets imbriqués
   (seo, source, illustration, zone) se fusionnent champ à champ : l'ancien
   front les écrasait, et deux frappes en moins de 550 ms sur deux champs SEO
   perdaient la première. */
const IMBRIQUES = new Set(["seo", "source", "illustration", "zone"]);
export function fusionnerPatch(pending: Patch, extra: Patch): Patch {
  const out: Patch = { ...pending };
  for (const [k, v] of Object.entries(extra)) {
    if (IMBRIQUES.has(k) && v && typeof v === "object" && out[k] && typeof out[k] === "object") out[k] = { ...(out[k] as object), ...(v as object) };
    else out[k] = v;
  }
  return out;
}

/* Ce que la ligne d'index doit refléter de l'article édité. */
export function calculsLigne(a: Article): { signs: number; reading: number; scores: Scores } {
  const A = analyze(a);
  return {
    signs: wordsOf(a), reading: readingOf(a),
    scores: {
      editorial: a.ranking, editorialBand: rankBand(a.ranking).key,
      seo: A.seoOK ? "conforme" : "a_revoir",
      conformity: { passed: A.passed, total: A.total, detail: { longueur: A.lengthOK, ranking: A.rankOK, source: A.sourceOK, illustration: A.illoOK, seo: A.seoOK } },
      ready: A.ready,
    },
  };
}

export const DELAI_PERSISTANCE_MS = 550;
