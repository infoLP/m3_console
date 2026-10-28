// Règles pures de l'onglet Sources : filtres, groupes, saisie d'une ligne,
// propositions (organisation par domaine, zone par commune), source depuis une
// demande. Ce que legacy/scripts/admin-main.js décidait dans le DOM, sans DOM.

import { setSourceUrl, groupSources, suggestOrganisations } from "@shared/sources.js";
import { intervalOf } from "@shared/sourceSchedule.js";
import { sourceRegion, zoneText, parseZoneText, regionName, deptName } from "@shared/zones.js";

export interface Source {
  id: string;
  name: string;
  kind?: "public" | "private" | string;
  type: string;
  active?: boolean;
  priority?: string;
  organisation?: string;
  commune?: string;
  category?: string;
  scopeLevel?: string;
  dept?: string;
  region?: string;
  frequency?: string;
  intervalDays?: number | string | null;
  selector?: string;
  rssUrl?: string;
  listUrl?: string;
  pressUrl?: string;
  siteUrl?: string;
  lastCheck?: { http?: number | string } | null;
  fromTicket?: string;
  /* Organisation telle qu'elle était quand on a commencé à la retaper : le
     regroupement s'en sert tant que le champ est actif, pour que la ligne ne
     change pas de place sous le curseur. Retiré à l'enregistrement. */
  orgAffichee?: string;
  [autre: string]: unknown;
}

export interface Demande {
  id: string;
  label: string;
  url?: string;
  sourceKind?: string;
  type?: string;
  organisation?: string;
  category?: string;
  commune?: string;
  scopeLevel?: string;
  dept?: string;
  region?: string;
  frequency?: string;
  status: string;
  note?: string;
  requestedBy: string;
  at: string;
}

/* État de la vue (M3-110, B3) : tout ce qui se lit dans l'URL. `grouper` n'est
   pas un filtre (il ne retire aucune ligne) mais voyage avec eux. */
export interface Filtres {
  kind: string;
  zone: string;
  activeOnly: boolean;
  q: string;
  probleme: string;
  grouper: boolean;
}

export const FILTRES_DEFAUT: Filtres = { kind: "", zone: "", activeOnly: false, q: "", probleme: "", grouper: true };

/* Ce dont le filtre « problème » a besoin en plus des sources : la fiabilité
   (lecture seule, par id) et l'instant de référence, fourni par le serveur pour
   que rendu serveur et hydratation tranchent pareil. */
export interface ContexteProblemes {
  fiabilite: Record<string, Fiabilite>;
  maintenant: number;
}

export const urlDe = (s: Source): string => s.rssUrl || s.listUrl || s.pressUrl || s.siteUrl || "";

/* Filtre « zone » : une région (ses départements compris) ou un département,
   ou « sans zone ». */
export function zoneMatches(s: Source, f: string): boolean {
  if (f === "none") return !s.dept && !s.region;
  if (f.startsWith("r:")) return sourceRegion(s) === f.slice(2);
  return s.dept === f.slice(2);
}

export function filtrerSources(sources: Source[], f: Filtres, ctx?: ContexteProblemes): Source[] {
  let rows = sources;
  if (f.probleme && ctx) rows = rows.filter((s) => aLeProbleme(problemesDe(s, ctx.fiabilite[s.id], ctx.maintenant), f.probleme));
  if (f.kind) rows = rows.filter((s) => (s.kind || "public") === f.kind);
  if (f.zone) rows = rows.filter((s) => zoneMatches(s, f.zone));
  if (f.activeOnly) rows = rows.filter((s) => s.active);
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((s) => (s.name + " " + (s.organisation || "") + " " + (s.commune || "") + " " + (s.category || "")).toLowerCase().includes(q));
  }
  return rows;
}

export function compteurs(sources: Source[]) {
  const nb = (k: string) => {
    const l = sources.filter((s) => (s.kind || "public") === k);
    return `${l.filter((s) => s.active).length}/${l.length}`;
  };
  return { actives: sources.filter((s) => s.active).length, total: sources.length, public: nb("public"), prive: nb("private") };
}

/* Les régions et départements qui portent au moins une source, avec leurs
   effectifs, pour le filtre « zone ». */
export function regionsPourFiltre(sources: Source[]) {
  const byRegion = new Map<string, Map<string, number>>();
  for (const s of sources) {
    const r = sourceRegion(s);
    if (!r) continue;
    if (!byRegion.has(r)) byRegion.set(r, new Map());
    if (s.dept) byRegion.get(r)!.set(s.dept, (byRegion.get(r)!.get(s.dept) || 0) + 1);
  }
  const count = (f: string) => sources.filter((s) => zoneMatches(s, f)).length;
  return {
    sansZone: count("none"),
    regions: [...byRegion].sort((a, b) => regionName(a[0]).localeCompare(regionName(b[0]), "fr")).map(([r, depts]) => ({
      code: r, nom: regionName(r), n: count(`r:${r}`),
      depts: [...depts].sort().map(([d, n]) => ({ code: d, nom: deptName(d), n })),
    })),
  };
}

/* Intervalle de récolte (M3-58) : en filigrane, ce que la récolte déduira du
   champ « fréquence », pour qu'on sache ce qui s'appliquera avant de corriger. */
export function indiceIntervalle(s: Source): { hint: string; title: string } {
  const auto = intervalOf({ frequency: s.frequency }) as { days?: number };
  return {
    hint: auto.days ? `auto : ${auto.days}` : "auto : 0",
    title: s.frequency ? `Fréquence saisie : « ${s.frequency} » → ${auto.days} j` : "Aucune fréquence saisie : à chaque récolte",
  };
}

export const idNouveau = () => "s-" + Date.now().toString(36);

export function nouvelleSource(kind: string): Source {
  return { id: idNouveau(), name: "Nouvelle source", kind: kind || "public", type: "rss", active: true, priority: "B" };
}

/* Source pré-remplie d'après une demande. Inactive : on ne récolte pas une
   source que personne n'a encore testée. */
export function sourceDepuisDemande(t: Demande): Source {
  const s: Source = { id: idNouveau(), name: t.label, kind: t.sourceKind || "public", type: t.type || "site", active: false, priority: "B", fromTicket: t.id };
  for (const k of ["organisation", "category", "commune", "scopeLevel", "dept", "region", "frequency"] as const) if (t[k]) s[k] = t[k];
  setSourceUrl(s, t.url);
  return s;
}

/* Deux clics feraient deux brouillons, et deux sources à l'enregistrement. */
export function memeAdresse(sources: Source[], t: Demande): boolean {
  return sources.some((x) => x.fromTicket === t.id || (!!t.url && [x.rssUrl, x.listUrl, x.pressUrl, x.siteUrl].includes(t.url)));
}

/* Une saisie dans une ligne. Rend une COPIE : la ligne modifiée est un nouvel
   objet, les autres gardent le leur (le tableau ne re-rend que celle-là).
   `invalide` : une zone en cours de frappe (« 1 », « Région · Nouv ») — rien
   n'est retenu tant qu'elle ne désigne pas un département ou une région. */
export function appliquerChamp(s: Source, champ: string, valeur: string | boolean): { source: Source; invalide?: boolean } {
  const n: Source = { ...s };
  if (champ === "active") n.active = Boolean(valeur);
  else if (champ === "url") setSourceUrl(n, String(valeur));
  else if (champ === "type") { n.type = String(valeur); setSourceUrl(n, urlDe(n)); }
  else if (champ === "zone") {
    const z = parseZoneText(String(valeur)) as { dept?: string; region?: string } | null;
    if (!z) return { source: s, invalide: true };
    n.dept = z.dept || undefined; n.region = z.region || undefined;
  }
  else if (champ === "organisation") {
    if (n.orgAffichee === undefined) n.orgAffichee = s.organisation || "";
    n.organisation = String(valeur);
  }
  else n[champ] = valeur;
  return { source: n };
}

/* Le champ organisation quitté : la ligne peut rejoindre son groupe. */
export function figerOrganisation(s: Source): Source {
  if (s.orgAffichee === undefined) return s;
  const n = { ...s };
  delete n.orgAffichee;
  return n;
}

export function pourEnregistrement(sources: Source[]): Source[] {
  return sources.map(figerOrganisation);
}

/* Groupes par organisation, en respectant l'organisation « affichée » d'une
   ligne en cours de frappe. */
export function groupes(sources: Source[]) {
  return groupSources(sources.map((s) => (s.orgAffichee === undefined ? s : { ...s, organisation: s.orgAffichee }))) as { key: string; label: string | null; sources: Source[] }[];
}

/* Proposition d'organisation par domaine : les sources touchées passent en
   « modifiées », rien n'est enregistré tant que l'administrateur n'a pas relu. */
export function proposerOrganisations(sources: Source[]): { sources: Source[]; ids: string[] } {
  const proposed = suggestOrganisations(sources) as Map<string, string>;
  const ids = [...proposed.keys()];
  return { sources: sources.map((s) => (proposed.has(s.id) ? { ...s, organisation: proposed.get(s.id) } : s)), ids };
}

export const sansZoneAvecCommune = (sources: Source[]) => sources.filter((s) => s.commune && !s.dept && !s.region);

/* Zone par commune : une proposition, relue avant « Enregistrer ». Une commune
   inconnue ou ambiguë est signalée, jamais devinée. */
export function proposerZones(sources: Source[], communes: Record<string, { dept?: string; ambiguous?: boolean } | null>) {
  const ids: string[] = [];
  const unknown = new Set<string>();
  const ambiguous = new Set<string>();
  const out = sources.map((s) => {
    if (!(s.commune && !s.dept && !s.region)) return s;
    const r = communes[s.commune];
    if (!r) { unknown.add(s.commune); return s; }
    if (r.ambiguous) { ambiguous.add(s.commune); return s; }
    ids.push(s.id);
    return { ...s, dept: r.dept, scopeLevel: s.scopeLevel || "commune" };
  });
  const left = [...unknown, ...[...ambiguous].map((c) => `${c} (ambiguë)`)];
  return { sources: out, ids, filled: ids.length, left };
}

export const texteZone = (s: Source): string => zoneText(s);

/* Fiabilité d'une source, telle que GET /api/sources la calcule par id
   (shared/sourceReliability.js + décomptes d'articles). Lecture seule : elle
   voyage à part des champs de Source, pour que « Enregistrer » ne la renvoie
   jamais au serveur. Absente pour une source inactive jamais récoltée. */
export interface Fiabilite {
  score: number | null;
  level: "nouvelle" | "fiable" | "moyenne" | "faible" | "muette" | string;
  reasons: string[];
  articles: Record<string, number>;
  lastItemAt: string | null;
  emptyStreak: number;
  /* État de récolte (harvest/sources-state.json), M3-110. */
  etat?: EtatRecolteBrut;
}

export interface EtatRecolteBrut {
  lastAttemptAt: string | null;
  lastOkAt: string | null;
  failures: number;
  quarantinedUntil: string | null;
  dernier: { at: string; ok: boolean; n: number } | null;
}

/* Ton de la pastille, repris des classes .bo-pill existantes. Le chiffre reste
   affiché à côté : le ton ne porte jamais l'information seul. */
export type TonFiabilite = "on" | "warn" | "bad" | "off";

const TONS: Record<string, TonFiabilite> = { fiable: "on", moyenne: "warn", faible: "bad", muette: "bad" };

/* JJ/MM/AAAA tiré de la chaîne ISO, sans fuseau : rendu serveur et navigateur
   donnent le même texte (pas d'écart d'hydratation). */
const dateCourte = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/* Cellule « Fiabilité » : score affiché, ton de la pastille, infobulle. */
export function affichageFiabilite(f: Fiabilite | null | undefined): { texte: string; ton: TonFiabilite; titre: string } {
  if (!f) return { texte: "—", ton: "off", titre: "Fiabilité inconnue : source jamais récoltée" };
  const ton = f.score == null ? "off" : TONS[f.level] || "off";
  const a = f.articles || {};
  const retenus = (a.valide || 0) + (a.publie || 0);
  const ecartes = (a.archive || 0) + (a.signale || 0);
  const lignes = [
    f.score == null ? `Score : — (${f.level})` : `Score : ${f.score}/100 (${f.level})`,
    `Rendement : ${f.reasons.length ? f.reasons.join(" ; ") : "rien à signaler"}`,
    `Récoltes vides d'affilée : ${f.emptyStreak || 0}`,
    `Dernier item : ${f.lastItemAt ? dateCourte(f.lastItemAt) : "aucun"}`,
  ];
  if (retenus + ecartes) lignes.push(`Articles : ${retenus} retenu(s), ${ecartes} écarté(s)`);
  return { texte: f.score == null ? "—" : String(f.score), ton, titre: lignes.join("\n") };
}

/* ---------- M3-110 : table en lecture, panneau, filtres dans l'URL ---------- */

/* Jour et heure à Paris : même texte au rendu serveur et dans le navigateur,
   quel que soit le fuseau de l'un ou de l'autre. */
const PARIS_JOUR = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
const PARIS_HEURE = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const jourParis = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : PARIS_JOUR.format(d); };
const jourHeureParis = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${PARIS_JOUR.format(d)} à ${PARIS_HEURE.format(d)}`; };

export type CleRecolte = "ok" | "echec" | "ecart" | "muette" | "jamais";
export type TonEtat = "go" | "amber" | "stop" | "neutre";

const TON_RECOLTE: Record<CleRecolte, TonEtat> = { ok: "go", echec: "stop", ecart: "amber", muette: "amber", jamais: "neutre" };

/* Cellule « Dernière récolte » : date courte de la dernière tentative et état,
   toujours écrit en toutes lettres (le ton ne fait que le doubler). Ordre :
   à l'écart > échec > muette > OK — le plus actionnable d'abord. */
export function etatRecolte(f: Fiabilite | null | undefined, maintenant: number): { cle: CleRecolte; date: string | null; texte: string; ton: TonEtat; titre: string } {
  const e = f?.etat;
  const quand = e?.dernier?.at || e?.lastAttemptAt || null;
  const date = quand ? jourParis(quand) : null;
  const res = (cle: CleRecolte, texte: string, titre: string) => ({ cle, date, texte, ton: TON_RECOLTE[cle], titre });
  if (!e || !quand) return res("jamais", "Jamais récoltée", "Aucune tentative de récolte enregistrée");
  const reussite = e.lastOkAt ? `Dernière réussite : ${jourHeureParis(e.lastOkAt)}` : "Jamais réussie";
  if (e.quarantinedUntil && Date.parse(e.quarantinedUntil) > maintenant) {
    return res("ecart", `À l'écart jusqu'au ${jourParis(e.quarantinedUntil)}`,
      `${e.failures} échec(s) d'affilée : plus tentée avant le ${jourHeureParis(e.quarantinedUntil)}. ${reussite}`);
  }
  if (e.failures > 0 || e.dernier?.ok === false) return res("echec", "Échec", `${e.failures || 1} échec(s) d'affilée. ${reussite}`);
  if (f?.level === "muette") return res("muette", "Muette", `${f.emptyStreak} récolte(s) vide(s) d'affilée. ${reussite}`);
  const n = e.dernier?.n;
  return res("ok", "OK", n != null ? `${n} contenu(s) à la dernière récolte. ${reussite}` : reussite);
}

/* Les causes de la puce « n avec un problème ». Une source peut en cumuler.
   Pas de « sans zone » (décision de l'utilisateur, 2026-10-15) : la zone de
   l'article est déduite à la génération, une source sans zone n'a rien d'anormal. */
export const CAUSES = ["echec", "muette", "faible", "jamais"] as const;
export type Cause = (typeof CAUSES)[number];
export const LIBELLE_CAUSE: Record<Cause, string> = {
  echec: "En échec ou à l'écart",
  muette: "Muettes",
  faible: "Fiabilité faible",
  jamais: "Actives jamais récoltées",
};
/* Valeur du filtre « problème » qui prend toutes les causes. */
export const TOUS_PROBLEMES = "tous";

export function problemesDe(s: Source, f: Fiabilite | null | undefined, maintenant: number): Cause[] {
  const e = f?.etat;
  const c: Cause[] = [];
  if (e && (e.failures > 0 || (!!e.quarantinedUntil && Date.parse(e.quarantinedUntil) > maintenant))) c.push("echec");
  if (f?.level === "muette") c.push("muette");
  if (f?.level === "faible") c.push("faible");
  if (s.active && !(e?.lastAttemptAt || e?.dernier)) c.push("jamais");
  return c;
}

export const aLeProbleme = (causes: Cause[], filtre: string) => (filtre === TOUS_PROBLEMES ? causes.length > 0 : causes.includes(filtre as Cause));

/* Effectifs des puces : par cause, et `total` = sources avec au moins une cause. */
export function compterProblemes(sources: Source[], ctx: ContexteProblemes): { total: number; parCause: Record<Cause, number> } {
  const parCause = Object.fromEntries(CAUSES.map((k) => [k, 0])) as Record<Cause, number>;
  let total = 0;
  for (const s of sources) {
    const c = problemesDe(s, ctx.fiabilite[s.id], ctx.maintenant);
    if (c.length) total++;
    for (const k of c) parCause[k]++;
  }
  return { total, parCause };
}

/* Filtres ↔ URL. Noms de paramètres en français, valeurs par défaut absentes de
   l'URL ; une valeur inconnue retombe sur le défaut (lien abîmé ou ancien). */
type ParamsBruts = URLSearchParams | Record<string, string | string[] | undefined>;
const lire = (p: ParamsBruts, k: string): string => {
  const v = p instanceof URLSearchParams ? p.get(k) : p[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};
const ZONE_VALIDE = /^(none|[rd]:[0-9A-Za-z]{1,3})$/;
const PROBLEMES_VALIDES = new Set<string>([TOUS_PROBLEMES, ...CAUSES]);

export function filtresDepuisUrl(p: ParamsBruts): Filtres {
  const volet = lire(p, "volet");
  const zone = lire(p, "zone");
  const probleme = lire(p, "probleme");
  return {
    q: lire(p, "q").slice(0, 200),
    kind: volet === "public" || volet === "private" ? volet : "",
    zone: ZONE_VALIDE.test(zone) ? zone : "",
    activeOnly: lire(p, "actives") === "1",
    grouper: lire(p, "grouper") !== "0",
    probleme: PROBLEMES_VALIDES.has(probleme) ? probleme : "",
  };
}

/* Rend les paramètres de la vue ; les autres paramètres de `base` (`demande`,
   par exemple) sont conservés tels quels. */
export function filtresVersUrl(f: Filtres, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  const poser = (k: string, v: string) => { if (v) p.set(k, v); else p.delete(k); };
  poser("q", f.q.trim() ? f.q : "");
  poser("volet", f.kind);
  poser("zone", f.zone);
  poser("actives", f.activeOnly ? "1" : "");
  poser("grouper", f.grouper ? "" : "0");
  poser("probleme", f.probleme);
  return p;
}

/* Un filtre retire-t-il des lignes ? (le lien « Effacer » n'apparaît qu'alors) */
export const filtreActif = (f: Filtres) => !!(f.q.trim() || f.kind || f.zone || f.activeOnly || f.probleme);

/* Effacer : les filtres reviennent au défaut, le regroupement reste comme choisi. */
export const effacerFiltres = (f: Filtres): Filtres => ({ ...FILTRES_DEFAUT, grouper: f.grouper });

/* Le nom découpé autour du terme recherché, pour le surligner (<mark>). Même
   comparaison que filtrerSources : insensible à la casse, sensible aux accents. */
export function decouperSurlignage(texte: string, q: string): { texte: string; marque: boolean }[] {
  const terme = q.trim().toLowerCase();
  if (!terme) return [{ texte, marque: false }];
  const bas = texte.toLowerCase();
  /* toLowerCase peut changer la longueur (rare : « İ ») ; les index ne
     correspondraient plus, on renonce alors au surlignage. */
  if (bas.length !== texte.length) return [{ texte, marque: false }];
  const out: { texte: string; marque: boolean }[] = [];
  let i = 0;
  for (let j = bas.indexOf(terme); j !== -1; j = bas.indexOf(terme, i)) {
    if (j > i) out.push({ texte: texte.slice(i, j), marque: false });
    out.push({ texte: texte.slice(j, j + terme.length), marque: true });
    i = j + terme.length;
  }
  if (i < texte.length) out.push({ texte: texte.slice(i), marque: false });
  return out.length ? out : [{ texte, marque: false }];
}

/* Colonne « Fréquence » : l'intervalle saisi s'il y en a un, sinon ce que la
   récolte déduit du champ « fréquence ». */
export function frequenceAffichee(s: Source): string {
  const iv = intervalOf({ intervalDays: s.intervalDays, frequency: s.frequency }) as { days: number; origin: string };
  const rythme = iv.days ? `tous les ${iv.days} j` : "à chaque récolte";
  if (iv.origin === "saisi") return `Intervalle : ${rythme}`;
  return s.frequency ? `${s.frequency} (${rythme})` : `— (${rythme})`;
}

/* Nombre d'articles rattachés à une source, tous statuts confondus. */
export const articlesDe = (f: Fiabilite | null | undefined): number => Object.values(f?.articles || {}).reduce((a, n) => a + (Number(n) || 0), 0);

/* Conséquence écrite de la suppression (B4). */
export function consequenceSuppression(f: Fiabilite | null | undefined, enregistree: boolean): string {
  if (!enregistree) return "Cette source n'a jamais été enregistrée : elle disparaît simplement de la liste.";
  const n = articlesDe(f);
  const articles = n === 0 ? "Aucun article ne lui est rattaché" : n === 1 ? "Son article reste dans l'historique" : `Ses ${n} articles restent dans l'historique`;
  return `${articles} ; elle ne sera plus récoltée. Effectif à l'enregistrement.`;
}

export const CONSEQUENCE_RESTAURATION = "Toute la table est remplacée par le référentiel : les modifications non figées dans la baseline sont perdues, ainsi que les modifications en cours non enregistrées.";

/* Résultat de « Tester la source » (POST /api/sources/:id/test, M3-110). */
export interface ResultatTest {
  ok: boolean;
  via: string | null;
  http: number | null;
  items: number;
  complets: number;
  exemples: string[];
  dureeMs: number;
  erreur: string | null;
  antiRobot: boolean;
}

const duree = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/* Mise en forme du résultat, rendue dans un Message du socle : ton, titre,
   lignes de détail, au plus 3 exemples. */
export function resumeTest(r: ResultatTest): { ton: "succes" | "avertissement" | "erreur"; titre: string; details: string[]; exemples: string[] } {
  const details: string[] = [];
  if (r.antiRobot) details.push("Protection anti-robot détectée : le site bloque la récolte automatique.");
  if (!r.ok) {
    details.push(r.erreur || "Erreur inconnue.");
    if (r.http) details.push(`Code HTTP ${r.http}.`);
  }
  const technique = [r.via ? `via ${r.via}` : "", `en ${duree(r.dureeMs)}`].filter(Boolean).join(", ");
  details.push(`Test ${technique}.`);
  const exemples = (r.exemples || []).slice(0, 3);
  if (!r.ok) return { ton: "erreur", titre: "Échec du test", details, exemples };
  if (!r.items) return { ton: "avertissement", titre: "Source joignable, mais aucun contenu trouvé", details, exemples };
  const titre = `${pluriel(r.items, "contenu trouvé", "contenus trouvés")}, dont ${pluriel(r.complets, "complet", "complets")} sur 14 jours`;
  return { ton: r.complets ? "succes" : "avertissement", titre, details, exemples };
}

/* ---------- M3-117 : liste blanche du furtif (src/api/sources.js) ---------- */

export interface LigneFurtifBase {
  id: string;
  name: string;
  /* false : la source n'est plus au référentiel, son état de récolte demeure. */
  connue: boolean;
  failures: number;
  lastOkAt: string | null;
  dernier: { at: string; ok: boolean; n: number } | null;
}
export interface LigneFurtif extends LigneFurtifBase { since: string; checkedAt: string | null; prochainRetest: string | null }
export interface LigneEcart extends LigneFurtifBase { quarantinedUntil: string; enFurtif: boolean }
export interface ListeBlancheFurtif { furtif: LigneFurtif[]; ecart: LigneEcart[] }

/* Dates affichées : jour et heure à Paris, « — » si absente. */
export const quandParis = (iso: string | null | undefined) => (iso ? jourHeureParis(iso) : "—");

/* Dernier résultat en toutes lettres (le ton ne fait que le doubler). */
export function dernierResultat(l: LigneFurtifBase): { texte: string; ton: TonEtat } {
  if (!l.dernier) return { texte: "Aucun passage enregistré", ton: "neutre" };
  return l.dernier.ok
    ? { texte: `OK, ${l.dernier.n} contenu(s) — ${jourHeureParis(l.dernier.at)}`, ton: "go" }
    : { texte: `Échec — ${jourHeureParis(l.dernier.at)}`, ton: "stop" };
}

export const CONSEQUENCE_RETRAIT_FURTIF =
  "La source sort de la liste blanche : la prochaine récolte la lit d'abord sans camouflage. Si elle répond encore 403, le furtif la réinscrit seul.";
