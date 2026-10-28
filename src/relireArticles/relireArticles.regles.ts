// Règles pures de la relecture : la file (index), ses six dimensions de filtre
// et leurs badges réconciliés, le résumé de l'accueil, l'article suivant.
// Porté de legacy/scripts/state.js — mêmes fonctions, sans état global : la
// portée (zone, département, volet, source, focus, préférences) est passée.

import { DEFAULT_SETTINGS, PROMPT_DEFAULTS, asBlocks, zoneClassOf } from "@shared/model.js";
import { analyze, missingCriteria, rankBand } from "@shared/scoring.js";
import { slugRuleDetail } from "@shared/slug.js";
import { organisationKey } from "@shared/sources.js";
import { checkIllustrationUrl } from "@shared/illustrationUrl.js";

export interface Zone { num?: string; dept?: string; commune?: string; region?: string; regionOnly?: boolean; origin?: string }
export interface Scores { editorial?: number; editorialBand?: string; seo?: string; conformity?: { passed: number; total: number; detail: Record<string, boolean> }; ready?: boolean }
export type Drapeau = string | { at?: string; type: string; detail?: string };

/* Une ligne de l'index servi par GET /api/articles : allégée, pour le rail et
   les compteurs. */
export interface Ligne {
  id: string;
  title: string;
  cat: string;
  zone: Zone;
  zoneClass?: string;
  status: string;
  ranking: number;
  signs: number;
  reading: number;
  scores?: Scores | null;
  flags?: Drapeau[];
  sourceKind?: string;
  sourceLabel?: string;
  updatedAt?: string;
  hasIllustration?: boolean;
  sourceId?: string;
  /* Date de génération (posée par la chaîne, pipeline.js) : c'est elle qui
     ordonne la file (M3-90). */
  createdAt?: string;
  /* Récupération de l'article et parution de la source : elles vivent dans le
     document (`origin`) et l'index ne les projette pas encore ; le rail les
     affiche dès qu'elles y sont (M3-90). */
  harvestedAt?: string | null;
  sourcePublishedAt?: string | null;
  /* Verdict de la relecture automatique (M3-89), s'il y en a eu une : « ok »,
     « a_corriger » ou « rejet ». La carte du rail en montre une pastille. */
  reviewVerdict?: string | null;
}

/* Relecture automatique stockée avec l'article (checks.review, M3-89). */
export interface Relecture {
  status: "fait" | "indisponible" | "plafond" | "echec" | string;
  verdict?: "ok" | "a_corriger" | "rejet" | string;
  fidelite?: number | null;
  hallucinations?: { extrait?: string; explication?: string }[];
  fautes?: { extrait?: string; correction?: string }[];
  resume?: string;
  detail?: string;
  /* Verdict par consigne de rédaction (M3-113, lot D), absent des relectures
     antérieures. ok null : sans objet ou non jugé. */
  consignes?: { cle: string; ok: boolean | null; extrait?: string }[];
  engine?: string | null;
  model?: string | null;
  at?: string;
}

/* Libellé et ton d'un verdict, pour la carte et le panneau. */
export const VERDICTS_RELECTURE: Record<string, { label: string; ton: "ok" | "warn" | "stop" }> = {
  ok: { label: "Conforme à la source", ton: "ok" },
  a_corriger: { label: "À corriger", ton: "warn" },
  rejet: { label: "À rejeter", ton: "stop" },
};

export interface Bloc { id: string; type: "p" | "h2" | "h3" | string; text: string }

/* L'article complet (GET /api/articles/:id). */
export interface Article {
  id: string;
  title: string;
  chapo: string;
  signature?: string;
  body: Bloc[] | string[];
  cat: string;
  ranking: number;
  rankingReason?: string;
  status: string;
  zone: Zone;
  zoneClass?: string;
  source?: { type: string; label?: string; url?: string } | null;
  illustration?: { url?: string; credit?: string } | null;
  seo: { metaTitle: string; metaDescription: string; slug: string; keywords: string[] };
  flags?: { type: string; detail?: string }[];
  mode?: string;
  provider?: string;
  publication?: { url?: string; scheduledAt?: string; publishedAt?: string } | null;
  decision?: { at?: string; byName?: string } | null;
  scores?: Scores | null;
  _llm?: { degraded?: boolean; cap?: unknown; error?: string } | null;
  [autre: string]: unknown;
}

export type ClasseZone = "hab" | "nonhab";
export type Focus = "" | "signale" | "hors_sujet" | "ready";

export interface Portee {
  zone: ClasseZone;
  dept: string | null;
  kind: "" | "public" | "private" | string;
  /* Filtre source (M3-59) : "" = toutes, `src:<id>` une source du référentiel,
     `org:<clé>` toute une organisation, `lib:<libellé>` un article sans
     identifiant de source. */
  sourceFilter: string;
  focus: Focus;
  /* Départements suivis (préférence de poste) ; vide = tous. */
  prefsDepts: string[];
  /* Organisation de chaque source (id → clé, cf. organisationParSource) : ce
     qu'il faut pour appliquer un filtre `org:`. Absent = aucun regroupement. */
  orgDe?: Record<string, string>;
}

/* Une source du référentiel, réduite à ce que la console en montre. */
export interface SourceRef { id: string; name: string; kind?: string; organisation?: string; active?: boolean; dept?: string }

export const PORTEE_DEFAUT: Portee = { zone: "hab", dept: null, kind: "", sourceFilter: "", focus: "", prefsDepts: [] };

export const FOCUS_LABELS: Record<string, string> = { signale: "Signalés", hors_sujet: "Sujet non local", ready: "Prêts à publier" };

/* Les cinq critères de conformité, dans l'ordre du cahier des charges : les
   clés de `scores.conformity.detail`, écrites par le serveur. */
export const CONFORMITY_CRITERIA: ReadonlyArray<readonly [string, string]> = [
  ["longueur", "Longueur"], ["ranking", "Alignement éditorial"], ["source", "Source citée"], ["illustration", "Illustration"], ["seo", "SEO complet"],
];

/* ---------- M3-72 : pas de parution sans les cinq critères ----------
   Le même contrôle sert au bouton de la console ET aux actions serveur
   (publier, passer en « valide » / « publie ») : un bouton grisé se contourne
   par un appel direct. L'illustration suit la FEAT « Parution sans
   illustration » (M3-93) : un rôle qui a le droit de publier sans image n'est
   pas bloqué sur ce critère — sinon la FEAT ne voudrait plus rien dire. */

export const CONFORMITE_REFUS = "Parution refusée : le cahier des charges n'est pas rempli.";

/* Libellés des critères non remplis, dans l'ordre du cahier des charges. */
export function criteresManquants(a: Article, settings?: Record<string, unknown> | null, opts: { sansIllustration?: boolean } = {}): string[] {
  // la règle vit dans shared/scoring.js : le planificateur (publishDue) l'applique aussi
  return missingCriteria(a, settings, opts);
}

/* Message de refus qui nomme ce qui manque, ou null si l'article peut partir. */
export function refusConformite(manquants: string[]): string | null {
  return manquants.length ? `${CONFORMITE_REFUS} Manque : ${manquants.join(", ")}.` : null;
}

/* Le contrôle côté serveur, ses lectures injectées (l'action serveur fournit
   l'article, les réglages et le droit de publier sans image du rôle effectif) :
   testable sans base ni session. */
export interface DepsParution {
  lireArticle: (id: string) => Promise<Article>;
  contexte: () => Promise<{ settings: Record<string, unknown> | null; sansIllustration: boolean }>;
}
export async function controlerParution(id: string, deps: DepsParution): Promise<string | null> {
  const [a, ctx] = await Promise.all([deps.lireArticle(id), deps.contexte()]);
  return refusConformite(criteresManquants(a, ctx.settings, { sansIllustration: ctx.sansIllustration }));
}

/* Statuts qui valent envoi en parution. */
export const STATUTS_PARUTION: ReadonlySet<string> = new Set(["valide", "publie"]);

/* Les signalements d'une ligne : l'index les projette en CHAÎNES, le document
   complet porte des objets. On accepte les deux. */
export function flagTypes(a: { flags?: Drapeau[] }): string[] {
  return (a.flags || []).map((f) => (typeof f === "string" ? f : f && f.type) || "").filter(Boolean);
}

export const zclass = (a: Ligne | Article): string => a.zoneClass || (zoneClassOf(a.zone) as string);
export const deptKey = (a: Ligne | Article): string => { const z = a.zone || {}; return z.num || (z.regionOnly ? "NA" : "HS"); };
export const isPending = (a: { status: string }) => a.status === "a_revoir" || a.status === "signale";

/* Date qui ordonne la file : la génération, à défaut la dernière modification
   (une ligne sans createdAt). En millisecondes, 0 si illisible. */
export function dateDeTri(a: { createdAt?: unknown; updatedAt?: unknown }): number {
  const t = Date.parse(String(a.createdAt || a.updatedAt || ""));
  return Number.isNaN(t) ? 0 : t;
}

/* M3-90 : les nouveaux articles en haut. L'ordre chronologique d'abord (le plus
   récent en tête, quel que soit son statut — arbitrage du 2026-10-14) ; à date
   égale, le statut départage (à revoir, signalés devant), puis le ranking. */
export function sortedIndex(index: Ligne[]): Ligne[] {
  return index.slice().sort((x, y) => {
    const px = isPending(x) ? 0 : 1;
    const py = isPending(y) ? 0 : 1;
    return dateDeTri(y) - dateDeTri(x) || px - py || (y.ranking || 0) - (x.ranking || 0);
  });
}

/* Les trois dates d'un article (M3-90) : récupération par la récolte, parution
   de la source, génération (et régénération, s'il y en a eu une). Lues dans le
   document complet (`origin`) ou dans une ligne d'index. null = inconnue. */
export interface DatesArticle { recuperation: string | null; publicationSource: string | null; generation: string | null; regeneration: string | null }
export function datesArticle(a: Ligne | Article): DatesArticle {
  const val = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const o = ((a as Article).origin || {}) as { harvestedAt?: unknown; publishedAt?: unknown };
  const l = a as Ligne;
  return {
    recuperation: val(o.harvestedAt) || val(l.harvestedAt),
    publicationSource: val(o.publishedAt) || val(l.sourcePublishedAt),
    generation: val(a.createdAt),
    regeneration: val((a as Article).regeneratedAt),
  };
}

/* Date courte, toujours à l'heure de Paris : le rail est d'abord rendu sur le
   serveur, dont le fuseau peut différer de celui du navigateur. L'heure n'est
   donnée que si la valeur en porte une (une parution de source est souvent un
   simple jour). */
export function dateCourte(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const o: Intl.DateTimeFormatOptions = { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric" };
  if (/T\d\d:\d\d/.test(iso)) { o.hour = "2-digit"; o.minute = "2-digit"; }
  return d.toLocaleString("fr-FR", o);
}

/* ---------- rail repliable par date de génération ----------
   Le jour se lit à l'heure de Paris, comme dateCourte : un article généré à
   23 h 30 UTC appartient au lendemain parisien. La date est celle de dateDeTri
   (createdAt, à défaut updatedAt pour une ligne ancienne), pour que les groupes
   suivent exactement l'ordre de sortedIndex. */
export const JOUR_INCONNU = "inconnu";
const fmtJour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/* « AAAA-MM-JJ » à Paris, ou JOUR_INCONNU si la ligne n'a pas de date lisible. */
export function jourDeGeneration(a: { createdAt?: unknown; updatedAt?: unknown }): string {
  const t = dateDeTri(a);
  return t ? fmtJour.format(new Date(t)) : JOUR_INCONNU;
}

export interface GroupeJour { jour: string; libelle: string; articles: Ligne[] }

/* Regroupe une file déjà filtrée et triée (filteredIndex) sans en changer
   l'ordre interne. Groupes du plus récent au plus ancien, jour inconnu en
   dernier. */
export function groupesParJour(list: Ligne[]): GroupeJour[] {
  const parJour = new Map<string, Ligne[]>();
  for (const a of list) {
    const j = jourDeGeneration(a);
    const g = parJour.get(j);
    if (g) g.push(a); else parJour.set(j, [a]);
  }
  return [...parJour.entries()]
    .sort(([x], [y]) => (x === JOUR_INCONNU ? 1 : y === JOUR_INCONNU ? -1 : y.localeCompare(x)))
    .map(([jour, articles]) => ({ jour, libelle: jour === JOUR_INCONNU ? "Date inconnue" : dateCourte(jour), articles }));
}

/* Un groupe est ouvert si l'utilisateur l'a choisi ; sans choix, seul le jour
   le plus récent de la file l'est. `choix` vient des préférences (railJours). */
export function jourOuvert(jour: string, groupes: GroupeJour[], choix: Record<string, boolean> | undefined): boolean {
  const c = choix && choix[jour];
  if (typeof c === "boolean") return c;
  return !!groupes.length && groupes[0].jour === jour;
}

/* Les choix gardés dans les préférences : on borne aux 60 jours les plus
   récents, pour que le stockage ne grossisse pas indéfiniment. */
export function choixJours(choix: Record<string, boolean> | undefined, jour: string, ouvert: boolean, garder = 60): Record<string, boolean> {
  const n = { ...(choix || {}), [jour]: ouvert };
  const cles = Object.keys(n).sort((x, y) => (x === JOUR_INCONNU ? -1 : y === JOUR_INCONNU ? 1 : y.localeCompare(x)));
  return Object.fromEntries(cles.slice(0, garder).map((k) => [k, n[k]]));
}

/* Prédicats par dimension. Chaque compteur applique toutes les dimensions SAUF
   la sienne, pour que les badges se réconcilient (Σ pastilles = badge zone =
   badge « Tout »). */
const passZone = (a: Ligne, p: Portee) => zclass(a) === p.zone;
const passDept = (a: Ligne, p: Portee) => !p.dept || deptKey(a) === p.dept;
const passKind = (a: Ligne, p: Portee) => !p.kind || (a.sourceKind || "") === p.kind;
const passPrefs = (a: Ligne, p: Portee) => !p.prefsDepts.length || p.prefsDepts.includes(deptKey(a));
/* Clé de filtre de la source d'une ligne : son identifiant, et le libellé
   seulement pour un article qui n'en a pas (saisi à la main, ancien). Deux
   sources de même nom ne fusionnent plus (M3-59). */
export const cleSource = (a: Ligne) => (a.sourceId ? `src:${a.sourceId}` : `lib:${a.sourceLabel || ""}`);
function passSource(a: Ligne, p: Portee) {
  const f = p.sourceFilter;
  if (!f) return true;
  if (f.startsWith("org:")) return !!a.sourceId && (p.orgDe || {})[a.sourceId] === f.slice(4);
  if (f.startsWith("src:") || f.startsWith("lib:")) return cleSource(a) === f;
  return (a.sourceLabel || "") === f;           // ancien filtre par libellé
}
const FOCUS: Record<string, (a: Ligne) => boolean> = {
  signale: (a) => a.status === "signale",
  hors_sujet: (a) => flagTypes(a).includes("hors_sujet"),
  ready: (a) => !!(a.scores && a.scores.ready),
};
const passFocus = (a: Ligne, p: Portee) => !p.focus || !FOCUS[p.focus] || FOCUS[p.focus](a);

export const inScope = (a: Ligne, p: Portee) => passZone(a, p) && passDept(a, p) && passKind(a, p) && passPrefs(a, p) && passSource(a, p) && passFocus(a, p);
export const filteredIndex = (index: Ligne[], p: Portee) => sortedIndex(index).filter((a) => inScope(a, p));

/* ---------- filtre « source » (M3-59) ----------
   Construit depuis le RÉFÉRENTIEL et non plus depuis les articles : une source
   de la portée apparaît même sans article, deux sources de même nom restent
   deux entrées, et les sources d'une même organisation se regroupent. */

/* id de source → clé d'organisation (organisationKey de shared/sources.js),
   pour les seules sources qui en ont une. */
export function organisationParSource(referentiel: SourceRef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of referentiel) { const k = organisationKey(s.organisation); if (k) out[s.id] = k; }
  return out;
}

export interface OptionSource { cle: string; label: string; count: number; pending: number }
/* `cle` = `org:<clé>` pour une organisation d'au moins deux sources (un
   `<optgroup>` avec « toute l'organisation »), null pour une source seule. */
export interface GroupeSources { cle: string | null; label: string | null; count: number; pending: number; sources: OptionSource[] }

const parCharge = <T extends { pending: number; count: number }>(lab: (x: T) => string) => (x: T, y: T) =>
  y.pending - x.pending || y.count - x.count || lab(x).localeCompare(lab(y), "fr");

/* Le filtre de la portée courante, hors filtre source lui-même. Une source du
   référentiel en fait partie si le volet (public / privé) est le sien et, à
   zéro article, si elle est active et que son département — quand elle en a un
   — est celui de la pastille et des départements suivis. Une source qui a des
   articles dans la portée y est toujours. */
export function filtreSources(index: Ligne[], p: Portee, referentiel: SourceRef[] = []) {
  const compte = new Map<string, { label: string; count: number; pending: number }>();
  for (const a of index) {
    if (!passZone(a, p) || !passDept(a, p) || !passKind(a, p) || !passPrefs(a, p) || !passFocus(a, p)) continue;
    const cle = cleSource(a);
    const e = compte.get(cle) || { label: a.sourceLabel || "—", count: 0, pending: 0 };
    e.count++;
    if (isPending(a)) e.pending++;
    compte.set(cle, e);
  }
  const dansDept = (d?: string) => !d || ((!p.dept || p.dept === d) && (!p.prefsDepts.length || p.prefsDepts.includes(d)));
  const orgs = new Map<string, GroupeSources>();
  const groupes: GroupeSources[] = [];
  const vues = new Set<string>();
  for (const s of referentiel) {
    const cle = `src:${s.id}`;
    const c = compte.get(cle);
    const horsVolet = s.kind === "parked" || (!!p.kind && (s.kind || "") !== p.kind);
    if (!c && (horsVolet || s.active === false || !dansDept(s.dept))) continue;
    vues.add(cle);
    const opt: OptionSource = { cle, label: s.name || c?.label || s.id, count: c?.count || 0, pending: c?.pending || 0 };
    const k = organisationKey(s.organisation);
    if (!k) { groupes.push({ cle: null, label: null, count: opt.count, pending: opt.pending, sources: [opt] }); continue; }
    let g = orgs.get(k);
    if (!g) { g = { cle: `org:${k}`, label: String(s.organisation).trim(), count: 0, pending: 0, sources: [] }; orgs.set(k, g); groupes.push(g); }
    g.sources.push(opt);
    g.count += opt.count;
    g.pending += opt.pending;
  }
  /* Articles dont la source n'est pas (ou plus) au référentiel : listés quand
     même, sinon ils deviendraient introuvables par ce filtre. */
  for (const [cle, c] of compte) {
    if (vues.has(cle)) continue;
    groupes.push({ cle: null, label: null, count: c.count, pending: c.pending, sources: [{ cle, label: c.label, count: c.count, pending: c.pending }] });
  }
  /* Une organisation d'une seule source ne mérite pas de groupe. */
  for (const g of groupes) if (g.cle && g.sources.length < 2) { g.cle = null; g.label = null; }
  for (const g of groupes) g.sources.sort(parCharge<OptionSource>((x) => x.label));
  groupes.sort(parCharge<GroupeSources>((g) => g.label || g.sources[0].label));
  return {
    groupes,
    total: groupes.reduce((n, g) => n + g.count, 0),
    nbSources: groupes.reduce((n, g) => n + g.sources.length, 0),
  };
}

export const pendingCount = (index: Ligne[]) => index.filter(isPending).length;
export const pendingInZone = (index: Ligne[], p: Portee, z: string) => index.filter((a) => isPending(a) && zclass(a) === z && passKind(a, p) && passPrefs(a, p) && passFocus(a, p)).length;
export const pendingInDept = (index: Ligne[], p: Portee, num: string) => index.filter((a) => isPending(a) && passZone(a, p) && deptKey(a) === num && passKind(a, p) && passFocus(a, p)).length;
export const pendingInKind = (index: Ligne[], p: Portee, kind: string) => index.filter((a) => isPending(a) && passZone(a, p) && passDept(a, p) && passPrefs(a, p) && passFocus(a, p) && (!kind || (a.sourceKind || "") === kind)).length;

/* Pastilles : départements présents dans la zone pour le volet courant. */
export function departmentsInZone(index: Ligne[], p: Portee, z: string): (Zone & { num: string })[] {
  const seen = new Set<string>();
  const out: (Zone & { num: string })[] = [];
  for (const a of sortedIndex(index)) {
    if (zclass(a) !== z || !passKind(a, p) || !passFocus(a, p)) continue;
    const key = deptKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...(a.zone || {}), num: key });
  }
  return out;
}

export function libellePastille(z: Zone & { num: string }) {
  return z.num === "NA" ? "Toute la région" : z.num === "HS" ? "Hors périmètre" : (z.dept || z.commune || z.num);
}

/* Photographie de la file, pour l'accueil : SANS aucun filtre de portée. */
export function queueSummary(index: Ligne[]) {
  const pending = index.filter(isPending);
  const missing: Record<string, number> = {};
  for (const [k] of CONFORMITY_CRITERIA) missing[k] = 0;
  let scored = 0;
  for (const a of pending) {
    const d = a.scores && a.scores.conformity && a.scores.conformity.detail;
    if (!d) continue;
    scored++;
    for (const [k] of CONFORMITY_CRITERIA) if (!d[k]) missing[k]++;
  }
  return {
    pending: pending.length,
    hab: pending.filter((a) => zclass(a) === "hab").length,
    nonhab: pending.filter((a) => zclass(a) === "nonhab").length,
    signale: pending.filter((a) => a.status === "signale").length,
    horsSujet: pending.filter((a) => flagTypes(a).includes("hors_sujet")).length,
    ready: pending.filter((a) => a.scores && a.scores.ready).length,
    readingMinutes: pending.reduce((n, a) => n + (Number(a.reading) || 0), 0),
    scored,
    missing,
  };
}

export function nextPending(index: Ligne[], p: Portee, id: string | null): string | null {
  const inZone = filteredIndex(index, p).filter((a) => isPending(a) && a.id !== id);
  if (inZone.length) return inZone[0].id;
  const any = sortedIndex(index).filter((a) => isPending(a) && a.id !== id);
  return any.length ? any[0].id : null;
}

/* Le voisin dans la file TELLE QU'ELLE EST FILTRÉE. */
export function voisin(index: Ligne[], p: Portee, selId: string | null, delta: number): string | null {
  const list = filteredIndex(index, p);
  if (!list.length) return null;
  const i = list.findIndex((a) => a.id === selId);
  const cible = list[i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + delta))];
  return cible && cible.id !== selId ? cible.id : null;
}

/* Les quatre compteurs de l'en-tête. */
export function kpisEntete(index: Ligne[], aujourdhui = new Date().toISOString().slice(0, 10)) {
  return {
    drafts: index.filter((a) => a.status === "brouillon" || a.status === "a_revoir").length,
    pending: pendingCount(index),
    signaled: index.filter((a) => a.status === "signale").length,
    publishedToday: index.filter((a) => a.status === "publie" && String(a.updatedAt).slice(0, 10) === aujourdhui).length,
  };
}

/* Une ligne d'index recopiée depuis l'article qu'on édite : le rail reste
   cohérent sans recharger. `scores` est recalculé par l'appelant (scoring). */
export function ligneDepuisArticle(row: Ligne, a: Article, calc: { signs: number; reading: number; scores: Scores }): Ligne {
  return { ...row, title: a.title, cat: a.cat, zone: a.zone, ranking: a.ranking, signs: calc.signs, reading: calc.reading, hasIllustration: !!a.illustration, scores: calc.scores, status: a.status };
}

export function remplacerLigne(index: Ligne[], ligne: Ligne): Ligne[] {
  return index.map((r) => (r.id === ligne.id ? ligne : r));
}

/* Après une décision ou une régénération : seuls statut, scores et ranking
   changent sur la ligne. */
export function ligneApresDecision(index: Ligne[], a: { id: string; status: string; scores?: Scores | null; ranking: number }): Ligne[] {
  return index.map((r) => (r.id === a.id ? { ...r, status: a.status, scores: a.scores ?? r.scores, ranking: a.ranking } : r));
}

/* Les départements que les Préférences proposent de suivre : ceux de la file. */
export function departementsDeLaFile(index: Ligne[]): string[] {
  return [...new Set(index.map((a) => a.zone && a.zone.num).filter((n): n is string => /^\d+$/.test(String(n))))].sort();
}

/* Filtre par défaut réglé au back-office (console_default_dept, M3-74) : posé
   seulement si la file en contient. */
export function deptParDefaut(index: Ligne[], dd: string | null | undefined, zone: string): string | null {
  return dd && zone === "hab" && index.some((a) => (a.zone || {}).num === dd) ? dd : null;
}

/* ---------- M3-113 : les Preuves, miroir des règles M3 ----------
   Une règle M3 (ce que le prompt exige, ce que checkRules ou finalize contrôle,
   ce que la grille note) donne UNE preuve, en « attendu → obtenu » :
   - l'attendu est figé à la génération (checks.length, checks.rules.checked) ;
     pour un article ancien, il vient des Paramètres actuels, et le dit ;
   - l'obtenu est mesuré à l'affichage sur l'article tel qu'il est, avec la
     fonction même du contrôle, quand l'article suffit à le mesurer.
   Quatre états, calculés par etatPreuve et nulle part ailleurs :
   - non conforme : une règle bloquante pour la parution [P] en échec ;
   - à vérifier   : toute autre règle en écart ;
   - conforme     : mesuré, et la règle est tenue ;
   - non mesuré   : contrôle désactivé, non lancé, sans matière, ou donnée non
     conservée. Jamais en vert. */

/* Recopie de SOURCE_LISIBLE_MIN (src/generate/finalize.js) : la console ne
   peut pas importer la chaîne de génération. Les deux doivent rester égales. */
export const SOURCE_LISIBLE_MIN = 200;

export type EtatPreuve = "conforme" | "non_conforme" | "a_verifier" | "non_mesure";
export type Famille = "parution" | "generation" | "fidelite" | "contexte";

/* Les familles, dans l'ordre de lecture des conformes repliés. */
export const FAMILLES: ReadonlyArray<readonly [Famille, string]> = [
  ["parution", "Cahier des charges"], ["generation", "Génération"], ["fidelite", "Fidélité à la source"], ["contexte", "Contexte"],
];

/* Règles bloquantes pour la parution [P] : les cinq critères de M3-72 (R1
   longueur, R5 à R9 le SEO, R10 ranking, R11 source, R12 illustration) et le
   texte du mock (R22). */
export const REGLES_BLOQUANTES: ReadonlySet<string> = new Set(["R1", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12", "R22"]);

/* L'état d'une preuve. `ok` : true = tenue, false = en écart, null = rien de
   mesuré. LA seule fonction qui décide d'un état. */
export function etatPreuve(regle: string, ok: boolean | null | undefined): EtatPreuve {
  if (ok === null || ok === undefined) return "non_mesure";
  if (ok) return "conforme";
  return REGLES_BLOQUANTES.has(regle) ? "non_conforme" : "a_verifier";
}

const GRAVITE_ETAT: Record<EtatPreuve, number> = { non_conforme: 0, a_verifier: 1, non_mesure: 2, conforme: 3 };
/* L'état d'une preuve à plusieurs lignes (SEO) : celui de sa pire ligne. */
export const pireEtat = (etats: EtatPreuve[]): EtatPreuve =>
  etats.reduce<EtatPreuve>((p, e) => (GRAVITE_ETAT[e] < GRAVITE_ETAT[p] ? e : p), "conforme");

/* Motif commun à tout ce que l'article n'a pas gardé : la ligne des non
   mesurés le regroupe, il n'apparaît qu'une fois. */
export const NON_CONSERVE = "non conservé pour cet article";
/* Consignes que rien ne mesure encore (lot D de M3-113). */
export const MOTIF_RELECTURE_AUTO = "contrôlées par la relecture automatique";

/* Consignes jugées par la relecture (checks.review.consignes, M3-113 lot D) :
   recopie des clés de CLES_CONSIGNES (src/llm/prompts/review.js), dans le même
   ordre ; la console ne peut pas importer la chaîne. partenaire_signale vit
   sous R20, les autres sont des preuves de la famille Génération. */
export const CONSIGNES_RELECTURE: ReadonlyArray<{ cle: string; regle: string; libelle: string; attendu: string }> = [
  { cle: "style_phrases_creuses", regle: "R25", libelle: "Phrases creuses", attendu: "aucune phrase creuse" },
  { cle: "chapo_factuel", regle: "R25", libelle: "Chapô factuel", attendu: "chapô factuel, non répété au 1er paragraphe" },
  { cle: "fin_concrete", regle: "R25", libelle: "Fin concrète", attendu: "fin sur un fait concret" },
  { cle: "angle", regle: "R25", libelle: "Angle", attendu: "ouvre sur ce qui touche le lecteur" },
  { cle: "communique_non_explique", regle: "R25", libelle: "Communiqué non expliqué", attendu: "n'explique pas ce qu'est un communiqué" },
  { cle: "date_redigee", regle: "R25", libelle: "Date rédigée (consigne DATE)", attendu: "date explicite, jamais « récemment »" },
  { cle: "partenaire_signale", regle: "R20", libelle: "Contenu partenaire", attendu: "l'article signale le contenu partenaire" },
];

export interface Passage { texte: string; ou: "article" | "source"; etiquette?: string }
export interface Citations { trouvees: number; total: number }
export interface EtatSource {
  url: string | null;
  /* null : ni état gardé ni texte source pour le dériver. */
  etat: "lue" | "illisible" | null;
  motif?: "texte_mince" | "extraction_repli";
  signes: number | null;
  /* null : non conservé (article ancien, ou nom de source non transmis). */
  emetteurNomme: boolean | null;
  citations: Citations | null;
  /* checks.sources présent : l'état a été calculé à la génération. */
  conserve: boolean;
}

/* Une ligne d'une preuve à plusieurs règles (le SEO : R5 à R9). */
export interface LignePreuve {
  cle: string;
  regle: string;
  libelle: string;
  etat: EtatPreuve;
  attendu: string;
  obtenu: string;
  parametresActuels?: boolean;
  aLaGeneration?: string[];
}
export interface Preuve {
  /* Ancre stable : `preuve-<cle>`. Les cinq critères gardent leur clé
     (longueur, ranking, source, illustration, seo) : la barre de décision y saute. */
  cle: string;
  critere?: string;
  regle: string;
  famille: Famille;
  libelle: string;
  etat: EtatPreuve;
  attendu: string;
  obtenu: string;
  /* L'attendu vient des Paramètres actuels, pas de la génération. */
  parametresActuels?: boolean;
  /* Pourquoi rien n'a été mesuré (état non_mesure). */
  motif?: string;
  detail?: string;
  lien?: string;
  passages?: Passage[];
  lignes?: LignePreuve[];
  /* Écarts constatés à la génération sur cette règle (checks.rules.violations). */
  aLaGeneration?: string[];
  pied?: string;
}

/* Une entrée de checks.rules.checked (contrat M3-113). */
interface Verifiee {
  cle?: string;
  attendu?: { min?: number; max?: number; texte?: string } | null;
  obtenu?: { valeur?: number | string; texte?: string; absentes?: unknown[]; lieux?: unknown[]; absents?: unknown[] } | null;
  ok?: boolean | null;
  motif?: string;
  retry?: boolean;
}
interface SourceStockee { url?: string | null; etat?: string; motif?: string; signes?: number; emetteurNomme?: boolean | null; citations?: Citations | null }
interface Controles {
  length?: { min?: number; max?: number; target?: number; pct?: number; sourceSigns?: number; signs?: number; ok?: boolean } | null;
  sources?: SourceStockee[];
  plagiarism?: { score?: number; verdict?: string; spans?: unknown[] } | null;
  review?: Relecture | null;
  date?: { detected?: string | null; source?: string | null; ok?: boolean; reason?: string | null; windowHours?: number } | null;
  geo?: { num?: string | null; commune?: string | null; regionOnly?: boolean; outsideNA?: boolean; locality?: string | null; origin?: string } | null;
  category?: { auto?: string; from?: string; evidence?: number; overridden?: boolean } | null;
  rules?: { attempts?: number; stopped?: string | null; violations?: { rule?: string; detail?: string }[]; checked?: Verifiee[] } | null;
  regen?: { tentatives?: { moteur?: string; modele?: string | null; relance?: boolean; verdict?: string; hallucinations?: number; motif?: string | null }[]; retenue?: number; issue?: string } | null;
  dedup?: { score?: number; against?: string | null } | null;
}
interface Origine { rawText?: string; sourceUrl?: string; extracted?: { _sourceType?: string } | null }

const controlesDe = (a: Article): Controles | null => (a.checks && typeof a.checks === "object" ? (a.checks as Controles) : null);
const origineDe = (a: Article): Origine | null => (a.origin && typeof a.origin === "object" ? (a.origin as Origine) : null);
const drapeauxDe = (a: Article): { type: string; detail?: string }[] =>
  (a.flags || []).map((f) => (typeof f === "string" ? { type: f } : f)).filter((f) => f && f.type);
const aDesCles = (o: unknown, k: string): boolean => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const entier = (n: number) => Math.round(n).toLocaleString("fr-FR");
const car = (n: number) => `${entier(n)} caractère${n > 1 ? "s" : ""}`;
/* Les passages entre « » d'un détail de drapeau (citations, relecture). */
const guillemets = (s: string | undefined): string[] => [...String(s || "").matchAll(/«\s*([^«»]+?)\s*»/g)].map((m) => m[1]);
/* Liste de textes stockée (citations, lieux) : chaînes ou objets { texte }. */
const textesDe = (l: unknown): string[] => (Array.isArray(l) ? l.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as { texte?: unknown; extrait?: unknown }).texte ?? (x as { extrait?: unknown }).extrait ?? "") : "")).map((t) => t.trim()).filter(Boolean) : []);
const dansBornes = (v: number, b: { min?: number; max?: number }) =>
  (b.min == null || v >= Number(b.min)) && (b.max == null || v <= Number(b.max));
const bornesTexte = (min: number | null | undefined, max: number, unite = "caractères") =>
  (min != null && min > 0 ? `${entier(min)}–${entier(max)} ${unite}` : `≤ ${entier(max)} ${unite}`);

/* État de LA source : checks.sources[0] quand il a été gardé ; sinon dérivé de
   ce qui est stocké (origin.rawText, origin.extracted, source.url). Une
   extraction de repli du mock (`_sourceType`) rend la source illisible même si
   l'état gardé disait « lue » : c'est celle que la génération a reçue.
   M3-113 : ce n'est plus un critère ; il motive les « non mesuré » de R13 à R15. */
export function etatSourceDe(a: Article): EtatSource {
  const c = controlesDe(a);
  const o = origineDe(a);
  const s: SourceStockee | null = Array.isArray(c?.sources) && c!.sources.length ? c!.sources[0] : null;
  const brut = typeof o?.rawText === "string" ? o.rawText : null;
  const repli = !!o?.extracted?._sourceType;
  const mince = brut !== null && brut.length <= SOURCE_LISIBLE_MIN;
  let etat: EtatSource["etat"] = s && (s.etat === "lue" || s.etat === "illisible") ? s.etat : brut !== null ? (mince || repli ? "illisible" : "lue") : null;
  let motif: EtatSource["motif"] = s?.motif === "texte_mince" || s?.motif === "extraction_repli" ? (s.motif as EtatSource["motif"]) : etat === "illisible" ? (mince ? "texte_mince" : "extraction_repli") : undefined;
  if (etat === "lue" && repli) { etat = "illisible"; motif = "extraction_repli"; }
  return {
    url: s?.url || a.source?.url || o?.sourceUrl || null,
    etat,
    ...(etat === "illisible" && motif ? { motif } : {}),
    signes: typeof s?.signes === "number" ? s.signes : brut !== null ? brut.replace(/\s+/g, " ").trim().length : null,
    emetteurNomme: typeof s?.emetteurNomme === "boolean" ? s.emetteurNomme : null,
    citations: s?.citations && typeof s.citations.total === "number" ? { trouvees: s.citations.trouvees, total: s.citations.total } : null,
    conserve: !!s,
  };
}

/* Pourquoi une source ne se prête pas aux contrôles de fidélité, ou null. */
function motifSourceIllisible(s: EtatSource): string | null {
  if (s.etat !== "illisible") return null;
  return s.motif === "extraction_repli"
    ? "source illisible : extraction de repli (moteur factice)"
    : `source de ${s.signes != null ? entier(s.signes) : "?"} signes (il en faut plus de ${SOURCE_LISIBLE_MIN})`;
}

const RAISONS_DATE: Record<string, string> = { future: "date annoncée dans le futur", trop_ancien: "hors de la fenêtre de récupération" };
const ORIGINES_DATE: Record<string, string> = { label: "étiquette de parution", iso: "date au format ISO", texte: "date relevée dans le texte" };
const ISSUES_RELANCE: Record<string, string> = { ok: "une relance a corrigé l'hallucination", hallucination_persistante: "hallucination persistante", aucune_relance: "aucune relance possible" };
const RELECTURE_NON_FAITE: Record<string, string> = { plafond: "relecture non faite : plafond de dépense atteint", indisponible: "relecture non faite : aucun moteur utilisable", echec: "relecture non faite : échec de l'appel" };
/* Écart de checkRules → clé de la preuve (ou de la ligne SEO) concernée. */
const REGLE_VERS_CLE: Record<string, string> = {
  title: "titre", h2_title: "intertitre", length: "longueur", h1: "plan_hn", h2_count: "plan_hn",
  meta_title: "balise_titre", meta_description: "meta", keywords: "mots_cles", slug: "slug",
};
/* Repli des réglages que /api/me n'envoie pas (fenêtre de récolte, doublons). */
const REPLIS_REGLAGES = { window_hours: 72, dedup_threshold: 0.5 };

export type OptionsPreuves = { sansIllustration?: boolean };

/* Les preuves d'un article, une par règle M3, dans l'ordre des familles. Les
   réglages sont ceux des Paramètres (moi.scoring) : ils donnent le seuil du
   ranking, et l'attendu d'un article ancien sans `checks.rules.checked`. */
export function preuvesDe(a: Article, settings?: Record<string, unknown> | null, opts: OptionsPreuves = {}): Preuve[] {
  const R = { ...DEFAULT_SETTINGS, ...PROMPT_DEFAULTS, ...REPLIS_REGLAGES, ...(settings || {}) } as unknown as Record<string, number>;
  const A = analyze(a, R as unknown as typeof DEFAULT_SETTINGS);
  const sd = A.seoDetail as typeof A.seoDetail & { mtMin?: number; mtMax?: number; mdMin?: number; mdMax?: number; kwMin?: number; kwCount?: number };
  const c = controlesDe(a);
  const drapeaux = drapeauxDe(a);
  const drapeau = (t: string) => drapeaux.find((f) => f.type === t);
  const src = etatSourceDe(a);
  const verifiees = Array.isArray(c?.rules?.checked) ? c!.rules!.checked!.filter((x) => x && typeof x === "object") : null;
  const verif = (cle: string): Verifiee | null => verifiees?.find((x) => x.cle === cle) || null;
  const att = (v: Verifiee | null) => (v && v.attendu && typeof v.attendu === "object" ? v.attendu : null);

  /* Écarts constatés à la génération, rangés sous la règle concernée. */
  const aLaGen: Record<string, string[]> = {};
  for (const v of c?.rules?.violations || []) {
    if (!v || !v.detail) continue;
    const k = REGLE_VERS_CLE[String(v.rule)] || "titre";
    (aLaGen[k] ||= []).push(String(v.detail));
  }
  const tentatives = Number(c?.rules?.attempts) || 0;
  const piedGen = tentatives > 1 ? `Après ${tentatives} demandes au modèle.` : undefined;
  const gen = (k: string) => (aLaGen[k] ? { aLaGeneration: aLaGen[k] } : {});

  const out: Preuve[] = [];
  const nonMesure = (p: Omit<Preuve, "etat" | "obtenu" | "attendu"> & { attendu?: string }, motif: string): Preuve =>
    ({ attendu: "", ...p, etat: "non_mesure", obtenu: "non mesuré", motif });

  /* ===== Cahier des charges (parution) ===== */

  /* R1 — longueur du corps */
  const L = c?.length;
  const fenetre = !!(L && Number(L.min) > 0 && Number(L.max) >= Number(L.min));
  const cible = fenetre && Number(L!.target) > 0
    ? ` (cible ${entier(Number(L!.target))}${Number(L!.pct) > 0 && Number(L!.sourceSigns) > 0 ? ` = ${L!.pct} % de ${entier(Number(L!.sourceSigns))} signes de la source` : ""})`
    : "";
  out.push({
    cle: "longueur", critere: "longueur", regle: "R1", famille: "parution", libelle: "Longueur du corps",
    etat: etatPreuve("R1", A.lengthOK),
    attendu: `${entier(A.lengthMin)}–${entier(A.lengthMax)} signes${cible}`,
    obtenu: `${entier(A.words)} signes${A.lengthOK ? "" : A.words < A.lengthMin ? ` (${entier(A.lengthMin - A.words)} de moins)` : ` (${entier(A.words - A.lengthMax)} de plus)`}`,
    ...(fenetre ? {} : { parametresActuels: true }),
    ...gen("longueur"),
  });

  /* R10 — ranking éditorial : seuil des Paramètres, bande, motif en entier */
  const seuil = Number(R.ranking_threshold) || 60;
  const score = Number(a.ranking) || 0;
  const bande = rankBand(score, R as unknown as typeof DEFAULT_SETTINGS) as { lab: string };
  const motifRanking = String(a.rankingReason || "").trim();
  out.push({
    cle: "ranking", critere: "ranking", regle: "R10", famille: "parution", libelle: "Alignement éditorial",
    etat: etatPreuve("R10", A.rankOK),
    attendu: `≥ ${seuil} (Paramètres)`,
    obtenu: `${score} · ${bande.lab}`,
    detail: motifRanking ? `Motif du modèle : ${motifRanking}` : "Aucun motif enregistré.",
  });

  /* R12 — illustration : une image ET son crédit (décision 6). Sous la FEAT
     « Parution sans illustration », l'absence d'image n'est plus bloquante. */
  const image = typeof A.illoImage === "boolean" ? A.illoImage : !!String(a.illustration?.url || "").trim();
  const credit = String(a.illustration?.credit || "").trim();
  const etatIllo = etatPreuve("R12", A.illoOK);
  /* M3-66 : une adresse que la publication ne pourra pas téléverser se signale
     ici, avant la parution ; elle ne la bloque pas (l'article part sans image). */
  const urlIllo = image ? checkIllustrationUrl(a.illustration?.url) : null;
  const detailIllo = [
    urlIllo && `${urlIllo} L'article partira sans image.`,
    etatIllo === "non_conforme" && opts.sansIllustration && "Votre rôle peut publier sans illustration.",
  ].filter(Boolean).join(" ");
  out.push({
    cle: "illustration", critere: "illustration", regle: "R12", famille: "parution", libelle: "Illustration",
    etat: etatIllo === "non_conforme" && opts.sansIllustration ? "a_verifier" : urlIllo && etatIllo === "conforme" ? "a_verifier" : etatIllo,
    attendu: "image et crédit",
    obtenu: !image ? "aucune image" : credit ? `image fournie · ${credit}` : "image fournie, crédit manquant",
    ...(detailIllo ? { detail: detailIllo } : {}),
  });

  /* R5 à R9 — SEO : une ligne par règle, l'attendu de la génération s'il a été
     gardé, l'état de la grille (la même que le refus de parution). R4 (un seul
     H1) est lue avec le plan Hn. */
  const seo = a.seo || ({} as Article["seo"]);
  const mt = String(seo.metaTitle || "").length;
  const md = String(seo.metaDescription || "").length;
  const kw = typeof sd.kwCount === "number" ? sd.kwCount : (seo.keywords || []).filter((k) => String(k ?? "").trim()).length;
  const slug = String(seo.slug || "");
  const motsSlug = slug ? slug.split("-").filter(Boolean).length : 0;
  const ol = sd.outline || { h1: 0, h2: 0 };
  const vMt = att(verif("balise_titre")), vMd = att(verif("meta")), vKw = att(verif("mots_cles")), vSlug = att(verif("slug")), vOl = att(verif("plan_hn"));
  const maxMotsSlug = Number(vSlug?.max ?? R.slug_max_words);
  const lignes: LignePreuve[] = [
    {
      cle: "balise_titre", regle: "R5", libelle: "Balise titre", etat: etatPreuve("R5", sd.mtOK),
      attendu: vMt?.texte || bornesTexte(sd.mtMin, sd.mtMax ?? R.meta_title_max), obtenu: mt ? car(mt) : "vide",
      ...(vMt ? {} : { parametresActuels: true }), ...gen("balise_titre"),
    },
    {
      cle: "meta", regle: "R6", libelle: "Méta-description", etat: etatPreuve("R6", sd.mdOK),
      attendu: vMd?.texte || bornesTexte(sd.mdMin ?? R.meta_desc_min, sd.mdMax ?? R.meta_desc_max), obtenu: md ? car(md) : "vide",
      ...(vMd ? {} : { parametresActuels: true }), ...gen("meta"),
    },
    {
      cle: "mots_cles", regle: "R7", libelle: "Mots-clés", etat: etatPreuve("R7", sd.kwOK),
      attendu: vKw?.texte || `≥ ${sd.kwMin ?? R.keywords_min} mots-clés`, obtenu: `${kw} mot${kw > 1 ? "s" : ""}-clé${kw > 1 ? "s" : ""}`,
      ...(vKw ? {} : { parametresActuels: true }), ...gen("mots_cles"),
    },
    {
      cle: "slug", regle: "R8", libelle: "Slug", etat: etatPreuve("R8", sd.slugOK),
      attendu: vSlug?.texte || `${maxMotsSlug > 0 ? `≤ ${maxMotsSlug} mots, ` : ""}minuscules et tirets, sans mot vide ni date`,
      obtenu: slug ? `${slug} (${motsSlug} mot${motsSlug > 1 ? "s" : ""})${sd.slugOK ? "" : ` : ${slugRuleDetail(slug, { slug_max_words: maxMotsSlug })}`}` : "vide",
      ...(vSlug ? {} : { parametresActuels: true }), ...gen("slug"),
    },
    {
      cle: "plan_hn", regle: "R9", libelle: "Plan Hn", etat: etatPreuve("R9", sd.olOK),
      attendu: vOl?.texte || `1 H1 (le titre)${sd.h2Min > 0 ? ` · ≥ ${sd.h2Min} H2` : ""}`, obtenu: `${ol.h1} H1 · ${ol.h2} H2`,
      ...(vOl ? {} : { parametresActuels: true }), ...gen("plan_hn"),
    },
  ];
  const seoEtat = pireEtat(lignes.map((l) => l.etat));
  const enEcart = lignes.filter((l) => l.etat !== "conforme");
  out.push({
    cle: "seo", critere: "seo", regle: "R5-R9", famille: "parution", libelle: "SEO",
    etat: seoEtat,
    attendu: "balise titre, méta-description, mots-clés, slug, plan Hn",
    obtenu: enEcart.length ? `en écart : ${enEcart.map((l) => l.libelle.toLowerCase()).join(", ")}` : "5 règles tenues",
    lignes,
    ...(piedGen ? { pied: piedGen } : {}),
  });

  /* R22 — pas de texte du mock en parution */
  if (typeof a.provider === "string" && a.provider) {
    const mock = a.provider === "mock";
    out.push({
      cle: "moteur", regle: "R22", famille: "parution", libelle: "Moteur de rédaction",
      etat: etatPreuve("R22", !mock), attendu: "un moteur réel, pas le générateur de secours",
      obtenu: mock ? "générateur de secours (mock) : à renvoyer à l'IA" : a.provider,
    });
  } else {
    out.push(nonMesure({ cle: "moteur", regle: "R22", famille: "parution", libelle: "Moteur de rédaction", attendu: "un moteur réel, pas le générateur de secours" }, NON_CONSERVE));
  }

  /* ===== Génération ===== */

  /* R2 — titre */
  const vTitre = att(verif("titre"));
  const titreAtt = vTitre && (vTitre.min != null || vTitre.max != null) ? vTitre : { max: Number(R.title_max) || 90 };
  const tl = String(a.title || "").trim().length;
  out.push({
    cle: "titre", regle: "R2", famille: "generation", libelle: "Titre",
    etat: etatPreuve("R2", tl > 0 && dansBornes(tl, titreAtt)),
    attendu: vTitre?.texte || bornesTexte(titreAtt.min, Number(titreAtt.max)),
    obtenu: tl ? car(tl) : "titre vide",
    ...(vTitre ? {} : { parametresActuels: true }), ...gen("titre"), ...(piedGen ? { pied: piedGen } : {}),
  });

  /* R3 — intertitres : le plus long */
  const vInter = att(verif("intertitre"));
  const interMax = Number(vInter?.max ?? R.h2_title_max) || 70;
  const inters = (asBlocks(a.body) as (Bloc | null)[]).filter((b): b is Bloc => !!b && (b.type === "h2" || b.type === "h3")).map((b) => String(b.text || "").trim().length);
  const interBase = { cle: "intertitre", regle: "R3", famille: "generation" as const, libelle: "Intertitres", attendu: vInter?.texte || `≤ ${car(interMax)}`, ...(vInter ? {} : { parametresActuels: true }), ...gen("intertitre") };
  if (!inters.length) out.push(nonMesure(interBase, "aucun intertitre"));
  else {
    const plusLong = Math.max(...inters);
    out.push({ ...interBase, etat: etatPreuve("R3", plusLong <= interMax), obtenu: `plus long : ${car(plusLong)}` });
  }

  /* R25, consigne DATE du prompt, mention partenaire : jugées par la relecture
     automatique (M3-113, lot D), une preuve par consigne. Sans verdict par
     consigne, une seule ligne non mesurée, avec le motif. */
  const relue = c?.review && c.review.status === "fait" ? c.review : null;
  const consignes = new Map((Array.isArray(relue?.consignes) ? relue!.consignes : [])
    .filter((x) => x && CONSIGNES_RELECTURE.some((k) => k.cle === x.cle)).map((x) => [x.cle, x] as const));
  const jugeeConsigne = (cle: string) => consignes.get(cle);
  if (consignes.size) {
    for (const k of CONSIGNES_RELECTURE) {
      if (k.regle !== "R25") continue;
      const v = jugeeConsigne(k.cle);
      const base = { cle: `consigne_${k.cle}`, regle: k.regle, famille: "generation" as const, libelle: k.libelle, attendu: k.attendu };
      /* ok null rendu par la relecture = consigne sans objet pour cet article : dit tel quel. */
      if (v && v.ok === null) out.push({ ...nonMesure(base, "sans objet pour cet article (relecture)"), obtenu: "sans objet" });
      else if (!v || typeof v.ok !== "boolean") out.push(nonMesure(base, "relecture sans verdict pour cette consigne"));
      else out.push({ ...base, etat: etatPreuve(k.regle, v.ok), obtenu: v.ok ? "tenue (relecture)" : "à vérifier (relecture)", ...(!v.ok && v.extrait ? { passages: [{ texte: String(v.extrait), ou: "article" as const, etiquette: "Relevé par la relecture" }] } : {}) });
    }
  } else {
    /* Relecture non conservée : le motif commun, tel quel, pour que la ligne
       des non mesurés ne le montre qu'une fois. */
    const r = c?.review;
    const motif = !c || !aDesCles(c, "review") ? NON_CONSERVE
      : `${MOTIF_RELECTURE_AUTO} ; ${!r ? "relecture désactivée ou non lancée"
        : r.status !== "fait" ? RELECTURE_NON_FAITE[String(r.status)] || `relecture non faite (${r.status})`
          : "relecture sans verdict par consigne"}`;
    out.push(nonMesure({ cle: "consignes", regle: "R25", famille: "generation", libelle: "Consignes de style, date rédigée, mention partenaire" }, motif));
  }

  /* ===== Fidélité à la source ===== */

  /* R11 — source citée (absorbe l'adresse de l'ancien « état de la source ») */
  const sansType = !a.source || !a.source.type || a.source.type === "none";
  out.push({
    cle: "source", critere: "source", regle: "R11", famille: "fidelite", libelle: "Source citée",
    etat: etatPreuve("R11", A.sourceOK), attendu: "type et adresse de la source",
    obtenu: A.sourceOK ? `${a.source?.label ? `${a.source.label} · ` : ""}${a.source?.url}` : sansType ? "aucune source déclarée" : "source sans adresse",
    ...(A.sourceOK && a.source?.url ? { lien: a.source.url } : {}),
  });

  const illisible = motifSourceIllisible(src);

  /* R13 — attribution : l'émetteur nommé tôt */
  const ATT_ATTRIB = "émetteur nommé dans le titre, le chapô ou les deux premiers paragraphes";
  const vAttrib = verif("attribution");
  const baseAttrib = { cle: "attribution", regle: "R13", famille: "fidelite" as const, libelle: "Attribution", attendu: att(vAttrib)?.texte || ATT_ATTRIB };
  if (vAttrib && typeof vAttrib.ok === "boolean") {
    out.push({ ...baseAttrib, etat: etatPreuve("R13", vAttrib.ok), obtenu: vAttrib.obtenu?.texte || (vAttrib.ok ? "oui" : "non") });
  } else if (vAttrib) {
    out.push(nonMesure(baseAttrib, vAttrib.motif || illisible || "nom de la source non transmis"));
  } else if (src.emetteurNomme !== null) {
    out.push({ ...baseAttrib, etat: etatPreuve("R13", src.emetteurNomme), obtenu: src.emetteurNomme ? "émetteur nommé" : "émetteur non nommé" });
  } else {
    out.push(nonMesure(baseAttrib, src.conserve ? illisible || "nom de la source non transmis" : NON_CONSERVE));
  }

  /* R14 — citations mot pour mot. 0 citation : rien à vérifier. */
  const fc = drapeau("citation_a_verifier");
  const passagesCit = fc ? guillemets(fc.detail).map((t): Passage => ({ texte: t, ou: "article", etiquette: "Absente telle quelle de la source" })) : [];
  const vCit = verif("citations");
  const baseCit = { cle: "citations", regle: "R14", famille: "fidelite" as const, libelle: "Citations exactes", attendu: att(vCit)?.texte || "citations entre « » présentes mot pour mot dans la source" };
  const cits = src.citations;
  if (fc) {
    out.push({
      ...baseCit, etat: "a_verifier",
      obtenu: vCit?.obtenu?.texte || (cits ? `${cits.trouvees}/${cits.total} retrouvées telles quelles` : "citation absente de la source"),
      detail: String(fc.detail || ""), ...(passagesCit.length ? { passages: passagesCit } : {}),
    });
  } else if (vCit && typeof vCit.ok === "boolean") {
    const abs = textesDe(vCit.obtenu?.absentes);
    out.push({ ...baseCit, etat: etatPreuve("R14", vCit.ok), obtenu: vCit.obtenu?.texte || "", ...(abs.length ? { passages: abs.map((t): Passage => ({ texte: t, ou: "article", etiquette: "Absente telle quelle de la source" })) } : {}) });
  } else if (vCit) {
    out.push(nonMesure(baseCit, vCit.motif || illisible || "aucune citation à vérifier"));
  } else if (cits && cits.total > 0) {
    out.push({ ...baseCit, etat: etatPreuve("R14", cits.trouvees === cits.total), obtenu: `${cits.trouvees}/${cits.total} retrouvées telles quelles` });
  } else if (cits) {
    out.push(nonMesure(baseCit, "aucune citation à vérifier"));
  } else {
    out.push(nonMesure(baseCit, src.conserve || src.etat === "illisible" ? illisible || "citations non vérifiées" : NON_CONSERVE));
  }

  /* R15 — aucun lieu absent de la source */
  const fh = drapeau("hallucination");
  const vLieux = verif("lieux");
  const baseLieux = { cle: "lieux", regle: "R15", famille: "fidelite" as const, libelle: "Lieux de la source", attendu: att(vLieux)?.texte || "lieux de l'article présents dans la source" };
  if (fh) {
    const lieux = (String(fh.detail || "").match(/:\s*([^.]+)\./) || [])[1];
    out.push({
      ...baseLieux, etat: "a_verifier", obtenu: vLieux?.obtenu?.texte || "lieu(x) absent(s) de la source", detail: String(fh.detail || ""),
      ...(lieux ? { passages: lieux.split(/,\s*/).map((t): Passage => ({ texte: t, ou: "article", etiquette: "Absent de la source" })) } : {}),
    });
  } else if (vLieux && typeof vLieux.ok === "boolean") {
    const abs = textesDe(vLieux.obtenu?.absents);
    out.push({ ...baseLieux, etat: etatPreuve("R15", vLieux.ok), obtenu: vLieux.obtenu?.texte || "", ...(abs.length ? { passages: abs.map((t): Passage => ({ texte: t, ou: "article", etiquette: "Absent de la source" })) } : {}) });
  } else if (vLieux) {
    out.push(nonMesure(baseLieux, vLieux.motif || illisible || "aucun lieu à vérifier"));
  } else {
    out.push(nonMesure(baseLieux, illisible || NON_CONSERVE));
  }

  /* R21 — relecture automatique, avec la ligne des relances (M3-55) */
  const baseRel = { cle: "relecture", regle: "R21", famille: "fidelite" as const, libelle: "Relecture automatique", attendu: "verdict « conforme à la source »" };
  const g = c?.regen;
  const ligneRelances = g
    ? (() => {
      const ts = g.tentatives || [];
      const gardee = ts[g.retenue ?? 0] || {};
      return `Relances : ${ISSUES_RELANCE[String(g.issue)] || g.issue || "?"} ; ${ts.filter((t) => t.relance && !t.motif).length} relance(s) ; version gardée n° ${(g.retenue ?? 0) + 1} sur ${ts.length} (${gardee.moteur || "?"}${gardee.modele ? ` · ${gardee.modele}` : ""}, ${gardee.hallucinations ?? "?"} hallucination(s)).`;
    })()
    : undefined;
  if (!c || !aDesCles(c, "review")) {
    out.push(nonMesure(baseRel, NON_CONSERVE));
  } else if (!c.review) {
    out.push(nonMesure(baseRel, "relecture désactivée ou non lancée"));
  } else if (c.review.status !== "fait") {
    const r = c.review;
    out.push(nonMesure(baseRel, `${RELECTURE_NON_FAITE[String(r.status)] || `relecture non faite (${r.status})`}${r.detail ? ` : ${r.detail}` : ""}`));
  } else {
    const r = c.review;
    const ok = r.verdict === "ok";
    const verdict = VERDICTS_RELECTURE[String(r.verdict)]?.label || String(r.verdict || "verdict inconnu");
    const nb = (r.hallucinations || []).length, nf = (r.fautes || []).length;
    const passages: Passage[] = [
      ...(r.hallucinations || []).filter((h) => h && h.extrait).map((h): Passage => ({ texte: String(h.extrait), ou: "article", etiquette: h.explication ? `Hallucination : ${h.explication}` : "Hallucination" })),
      ...(r.fautes || []).filter((f) => f && f.extrait).map((f): Passage => ({ texte: String(f.extrait), ou: "article", etiquette: f.correction ? `Faute, corriger en : ${f.correction}` : "Faute" })),
    ];
    out.push({
      ...baseRel, etat: etatPreuve("R21", ok),
      obtenu: `${verdict}${nb ? ` · ${nb} hallucination${nb > 1 ? "s" : ""}` : ""}${nf ? ` · ${nf} faute${nf > 1 ? "s" : ""}` : ""}`,
      detail: [`${r.engine ? `Relu par ${r.engine}${r.model ? ` ${r.model}` : ""}` : "Relecture"}${typeof r.fidelite === "number" ? ` · fidélité ${r.fidelite}/100` : ""}.`, r.resume || r.detail || ""].filter(Boolean).join(" "),
      ...(passages.length ? { passages } : {}),
    });
  }
  if (ligneRelances) {
    const rel = out[out.length - 1];
    rel.pied = ligneRelances;
    if (g!.issue === "hallucination_persistante" && rel.etat === "conforme") rel.etat = "a_verifier";
  }

  /* R19 — originalité, en mode presse seulement */
  if (c?.plagiarism || (a.mode === "press" && c)) {
    const p = c?.plagiarism;
    const base = { cle: "plagiat", regle: "R19", famille: "fidelite" as const, libelle: "Originalité (anti-plagiat)", attendu: "pas de risque de plagiat" };
    if (!p) out.push(nonMesure(base, NON_CONSERVE));
    else {
      const spans = (p.spans || []).map((s) => String(s || "").trim()).filter(Boolean);
      out.push({
        ...base, etat: etatPreuve("R19", p.verdict !== "risque"), obtenu: `proximité de ${Math.round(Number(p.score || 0) * 100)} % avec la source`,
        ...(spans.length ? { passages: spans.map((t): Passage => ({ texte: t, ou: "article", etiquette: "Trop proche de la source" })) } : {}),
      });
    }
  }

  /* R20 — contenu partenaire : la source l'est, l'article doit le dire */
  /* Le verdict de la relecture (partenaire_signale) tranche quand il est
     booléen ; sans lui, le drapeau reste « à lire ». */
  const fp = drapeau("contenu_partenaire");
  const vp = jugeeConsigne("partenaire_signale");
  const okP = vp && typeof vp.ok === "boolean" ? vp.ok : null;
  if (fp || okP !== null) {
    out.push({
      cle: "partenaire", regle: "R20", famille: "fidelite", libelle: "Contenu partenaire",
      etat: okP === null ? "a_verifier" : etatPreuve("R20", okP),
      attendu: "l'article signale le contenu partenaire",
      obtenu: okP === null ? "source de partenaire détectée : à lire" : okP ? "signalé (relecture)" : "non signalé (relecture)",
      ...(fp ? { detail: String(fp.detail || "") } : {}),
      ...(okP === false && vp!.extrait ? { passages: [{ texte: String(vp!.extrait), ou: "article" as const, etiquette: "Relevé par la relecture" }] } : {}),
    });
  }

  /* ===== Contexte ===== */

  /* R16 — zone couverte. Aucun lieu reconnu : rien de mesuré. */
  const fg = drapeau("hors_sujet");
  const baseGeo = { cle: "geo", regle: "R16", famille: "contexte" as const, libelle: "Zone", attendu: "dans les zones couvertes" };
  if (c?.geo) {
    const z = c.geo;
    const lieu = z.commune ? `${z.commune}${z.num ? ` (${z.num})` : ""}` : z.num ? `département ${z.num}` : z.regionOnly ? "région seulement" : null;
    const passagesGeo = z.locality ? { passages: [{ texte: String(z.locality), ou: "source", etiquette: "Localité extraite de la source" } as Passage] } : {};
    if (z.outsideNA) out.push({ ...baseGeo, etat: "a_verifier", obtenu: `hors zone : ${lieu || z.locality || "?"}, lu dans ${z.origin === "source" ? "la source" : "l'article"}`, ...passagesGeo });
    else if (!lieu) out.push(nonMesure(baseGeo, "aucun lieu reconnu"));
    else out.push({ ...baseGeo, etat: "conforme", obtenu: `${lieu}, lu dans ${z.origin === "source" ? "la source" : "l'article"}`, ...passagesGeo });
  } else if (fg) {
    out.push({ ...baseGeo, etat: "a_verifier", obtenu: "hors des zones couvertes", detail: String(fg.detail || "") });
  } else {
    out.push(nonMesure(baseGeo, NON_CONSERVE));
  }

  /* R17 — fraîcheur de la SOURCE (pas la consigne DATE du prompt, R25) */
  const fd = drapeau("date_suspecte");
  const heures = Number(c?.date?.windowHours) > 0 ? Number(c!.date!.windowHours) : Number(R.window_hours) || 72;
  const baseDate = {
    cle: "date", regle: "R17", famille: "contexte" as const, libelle: "Fraîcheur de la source",
    attendu: `parue il y a ${Math.round(heures / 24 + 7)} j au plus, et pas plus de 60 j dans le futur`,
    ...(Number(c?.date?.windowHours) > 0 ? {} : { parametresActuels: true }),
  };
  if (c?.date) {
    const d = c.date;
    const quand = d.detected ? new Date(d.detected).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }) : null;
    if (!quand) out.push(nonMesure(baseDate, "aucune date trouvée dans la source"));
    else {
      const ok = d.ok !== false;
      out.push({
        ...baseDate, etat: etatPreuve("R17", ok),
        obtenu: `${quand}${d.source ? ` (${ORIGINES_DATE[d.source] || d.source})` : ""}${ok ? "" : ` : ${RAISONS_DATE[String(d.reason)] || d.reason || "suspecte"}`}`,
        ...(ok ? {} : { passages: [{ texte: quand, ou: "source", etiquette: "Date retenue" } as Passage] }),
      });
    }
  } else if (fd) {
    out.push({ ...baseDate, etat: "a_verifier", obtenu: "date suspecte", detail: String(fd.detail || "") });
  } else {
    out.push(nonMesure(baseDate, NON_CONSERVE));
  }

  /* R18 — rubrique pertinente */
  const vRub = verif("rubrique");
  const k = c?.category;
  const baseRub = { cle: "rubrique", regle: "R18", famille: "contexte" as const, libelle: "Rubrique", attendu: att(vRub)?.texte || "la rubrique du modèle, confirmée par le texte" };
  const corrigee = !!k && (k.overridden === true || (k.overridden === undefined && !!k.auto));
  if (k && corrigee) {
    out.push({ ...baseRub, etat: "a_verifier", obtenu: `« ${k.from || "?"} » remplacée par « ${k.auto} »${typeof k.evidence === "number" ? ` (${k.evidence} indice(s))` : ""}` });
  } else if (vRub && typeof vRub.ok === "boolean") {
    out.push({ ...baseRub, etat: etatPreuve("R18", vRub.ok), obtenu: vRub.obtenu?.texte || "" });
  } else if (k && k.overridden === false) {
    out.push({ ...baseRub, etat: "conforme", obtenu: `retenue : ${k.from || a.cat}` });
  } else {
    out.push(nonMesure(baseRub, vRub?.motif || NON_CONSERVE));
  }

  /* R23 — pas de doublon (seuil des Paramètres : il n'est pas gardé) */
  const fdup = drapeau("doublon");
  const seuilDup = Number(R.dedup_threshold);
  const baseDup = { cle: "doublon", regle: "R23", famille: "contexte" as const, libelle: "Doublon", attendu: `proximité < ${seuilDup.toLocaleString("fr-FR")}`, parametresActuels: true };
  if (c?.dedup && typeof c.dedup.score === "number") {
    const ok = !fdup && c.dedup.score < seuilDup;
    out.push({ ...baseDup, etat: etatPreuve("R23", ok), obtenu: `${c.dedup.score.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${c.dedup.against ? ` (proche de « ${c.dedup.against} »)` : ""}`, ...(fdup ? { detail: String(fdup.detail || "") } : {}) });
  } else if (fdup) {
    out.push({ ...baseDup, etat: "a_verifier", obtenu: "sujet proche d'un autre article", detail: String(fdup.detail || "") });
  } else {
    out.push(nonMesure(baseDup, NON_CONSERVE));
  }

  return out;
}

/* ---------- l'ordre de lecture ----------
   1. verdict de tête ; 2. non conformes ; 3. à vérifier ; 4. les familles, avec
   leurs conformes (repliés) ; 5. une ligne grise des non mesurés, groupés par
   motif (« non conservé » n'y figure donc qu'une fois). */
export interface GroupeNonMesure { motif: string; preuves: Preuve[] }
export interface LecturePreuves {
  verdict: { bloquants: number; aVerifier: number; nonMesures: number; publiable: boolean };
  nonConformes: Preuve[];
  aVerifier: Preuve[];
  familles: { famille: Famille; libelle: string; preuves: Preuve[] }[];
  nonMesures: GroupeNonMesure[];
}

export function lecturePreuves(ps: Preuve[]): LecturePreuves {
  const de = (e: EtatPreuve) => ps.filter((p) => p.etat === e);
  const nm = de("non_mesure");
  const groupes = new Map<string, Preuve[]>();
  for (const p of nm) {
    const m = p.motif || NON_CONSERVE;
    const g = groupes.get(m);
    if (g) g.push(p); else groupes.set(m, [p]);
  }
  return {
    verdict: { bloquants: de("non_conforme").length, aVerifier: de("a_verifier").length, nonMesures: nm.length, publiable: de("non_conforme").length === 0 },
    nonConformes: de("non_conforme"),
    aVerifier: de("a_verifier"),
    familles: FAMILLES.map(([famille, libelle]) => ({ famille, libelle, preuves: ps.filter((p) => p.famille === famille && p.etat === "conforme") })).filter((f) => f.preuves.length > 0),
    nonMesures: [...groupes.entries()].map(([motif, preuves]) => ({ motif, preuves })),
  };
}

/* Le verdict de tête, en une ligne. */
export function verdictPreuves(v: LecturePreuves["verdict"]): string {
  const n = (x: number, un: string, plusieurs: string) => `${x} ${x > 1 ? plusieurs : un}`;
  return `${v.publiable ? "Publiable" : "Non publiable"} : ${n(v.bloquants, "bloquant", "bloquants")} · ${v.aVerifier} à vérifier · ${n(v.nonMesures, "non mesuré", "non mesurés")}`;
}
