// Règles pures de l'onglet Sources → Concurrents (M3-120) : qui voit quoi dans
// la coque du back-office et dans la console, et ce que l'écran vérifie avant
// d'appeler le serveur. Le serveur revérifie tout (src/lib/competitors.js).

import { can } from "@shared/model.js";
import { quandParis, sourceDepuisDemande, type Source } from "@/gererSources/gererSources.regles";

export interface Concurrent {
  id: number;
  label: string;
  url: string;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /* M3-122 : dernier passage du scan (colonnes last_scan_*), null si jamais scanné. */
  lastScan?: DernierScan | null;
}

export interface DernierScan { at: string; status: "ok" | "vide" | "erreur" | string | null; via: string | null; error: string | null }

export interface Saisie { label: string; url: string }

export const SAISIE_VIDE: Saisie = { label: "", url: "" };

/* ---------- Accès (décision de l'utilisateur du 2026-10-27) ---------- */

/* La coque /admin s'ouvre avec l'un de ces droits ; chaque page garde sa garde. */
export const DROITS_COQUE_ADMIN = ["backoffice", "manage_competitors"] as const;

export const HREF_CONCURRENTS = "/admin/concurrents";

export type Onglet = readonly [href: string, libelle: string, icone: string];

/* La colonne du back-office. Avec `backoffice` : tous les onglets. Sans lui
   (superutilisateur) : le seul onglet Sources, qui mène alors directement à
   Concurrents — la page Sources elle-même lui reste fermée. */
export function ongletsVisibles(onglets: readonly Onglet[], role: string): Onglet[] {
  if (can(role, "backoffice")) return [...onglets];
  if (!can(role, "manage_competitors")) return [];
  return onglets.filter(([href]) => href === "/admin").map(([, libelle, icone]) => [HREF_CONCURRENTS, libelle, icone] as const);
}

/* Sous-navigation de l'onglet Sources : « Sources » pour qui a `backoffice`,
   « Concurrents » pour qui a `manage_competitors`. */
export function sousOngletsSources(role: string): Onglet[] {
  const o: Onglet[] = [];
  if (can(role, "backoffice")) o.push(["/admin", "Sources", "Sliders"]);
  if (can(role, "manage_competitors")) o.push([HREF_CONCURRENTS, "Concurrents", "Globe"]);
  return o;
}

/* Console : le lien « Back-office » suffit à qui l'a ; sinon un lien direct vers
   Concurrents pour qui peut les gérer. */
export const lienConcurrentsConsole = (role: string) => can(role, "manage_competitors") && !can(role, "backoffice");

/* ---------- Saisie ---------- */

/* Même règle que normalizeUrl (src/lib/competitors.js) : l'écran évite un aller-retour. */
export function adresseValide(brut: string): boolean {
  let u: URL;
  try { u = new URL(brut.trim()); } catch { return false; }
  return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password && !u.search && !u.hash;
}

export function refusSaisie(s: Saisie): string | null {
  const l = s.label.trim();
  if (l.length < 2) return "Libellé trop court (2 caractères au moins).";
  if (l.length > 80) return "Libellé trop long (80 caractères au plus).";
  if (!adresseValide(s.url)) return "Adresse invalide : http:// ou https://, sans identifiant, paramètre ni ancre.";
  return null;
}

export const consequenceRetrait = (c: Concurrent) =>
  `« ${c.label} » sort de la liste. Pour seulement arrêter de le suivre en gardant la ligne, désactivez-le.`;

/* ---------- Scan et domaines candidats (M3-122) ---------- */

/* Le contrat du moteur (src/ingest/competitorScan.js, M3-121). */
export interface EtatScan {
  running: boolean;
  startedAt: string | null;
  last: { at: string; trigger: "planifie" | "manuel" | string; by: string | null; competitors: number; errors: number; candidates: number } | null;
  enabled: boolean;
  next: string | null;
}

export type StatutCandidat = "nouveau" | "propose" | "ajoute" | "ecarte";

export interface Candidat {
  id: number;
  domain: string;
  status: StatutCandidat;
  occurrences: number;
  competitors: { id: number; label: string }[];
  articles: { url: string; title?: string | null; competitorId?: number }[];
  firstSeenAt: string;
  lastSeenAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export const STATUTS: readonly (readonly [StatutCandidat, string])[] = [
  ["nouveau", "Nouveaux"], ["propose", "Proposés"], ["ajoute", "Ajoutés"], ["ecarte", "Écartés"],
];

export const statutValide = (s: unknown): s is StatutCandidat => STATUTS.some(([k]) => k === s);

/* Le bandeau au-dessus de la liste : ce qui tourne, ce qui a tourné, ce qui
   tournera. `null` : moteur pas encore livré. */
export function texteBandeau(etat: EtatScan | null): { etat: string; dernier: string; prochain: string } {
  if (!etat) return { etat: "", dernier: "Le scan des concurrents n'est pas encore disponible.", prochain: "" };
  const l = etat.last;
  const dernier = l
    ? `Dernier scan : ${quandParis(l.at)} (${l.trigger === "manuel" ? `manuel${l.by ? `, par ${l.by}` : ""}` : "planifié"}) — `
      + `${l.competitors} concurrent(s) lu(s)${l.errors ? `, ${l.errors} en erreur` : ""}, ${l.candidates} nouveau(x) domaine(s).`
    : "Aucun scan pour l'instant.";
  const prochain = etat.enabled
    ? (etat.next ? `Prochain scan planifié : ${quandParis(etat.next)}.` : "Scan quotidien activé, sans créneau à venir.")
    : "Scan quotidien désactivé.";
  return { etat: etat.running ? `Scan en cours depuis ${quandParis(etat.startedAt)}.` : "", dernier, prochain };
}

/* Les réglages du scan sont dans Paramètres, qui demande `backoffice`. */
export const lienParametres = (role: string) => can(role, "backoffice");

const VOIES: Record<string, string> = { page: "page liste", flux: "flux RSS", sitemap: "sitemap" };

/* Colonne « Dernier scan » d'un concurrent. */
export function dernierScan(c: Concurrent): { texte: string; detail: string | null; erreur: boolean } {
  const s = c.lastScan;
  if (!s) return { texte: "jamais", detail: null, erreur: false };
  const quand = quandParis(s.at);
  if (s.status === "erreur") return { texte: quand, detail: s.error || "erreur", erreur: true };
  const voie = s.via ? `par ${VOIES[s.via] || s.via}` : null;
  return { texte: quand, detail: s.status === "vide" ? ["aucun article", voie].filter(Boolean).join(", ") : voie, erreur: false };
}

/* Les actions sur un candidat. L'administrateur (manage_sources) crée la
   source ; le superutilisateur la propose à l'administrateur ; les deux
   écartent. Rien sur un domaine déjà ajouté ou écarté. */
export function actionsCandidat(role: string, c: Pick<Candidat, "status">): { creer: boolean; proposer: boolean; ecarter: boolean } {
  const ouvert = c.status === "nouveau" || c.status === "propose";
  const gere = can(role, "manage_competitors");
  const admin = can(role, "manage_sources");
  return {
    creer: ouvert && admin,
    proposer: c.status === "nouveau" && gere && !admin,
    ecarter: ouvert && gere,
  };
}

export const hrefCreerSource = (c: Pick<Candidat, "id">) => `/admin?candidat=${c.id}`;

/* La source pré-remplie que « Créer la source » ouvre dans Sources, comme pour
   une demande : inactive, à relire. `fromCandidate` dit, à l'enregistrement,
   quel candidat passe à « ajouté ». */
export function sourceDepuisCandidat(c: Pick<Candidat, "id" | "domain">): Source {
  const s = sourceDepuisDemande({ id: `cand-${c.id}`, label: c.domain, url: `https://${c.domain}`, status: "ouvert", requestedBy: "", at: "" });
  delete s.fromTicket;
  s.fromCandidate = c.id;
  return s;
}

/* Une source existe déjà pour ce domaine (www. compris) ? */
export function sourcePourDomaine(sources: Source[], domaine: string): Source | null {
  const hote = (u: unknown) => { try { return new URL(String(u)).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
  const d = domaine.toLowerCase();
  return sources.find((s) => [s.rssUrl, s.listUrl, s.pressUrl, s.siteUrl].some((u) => { const h = hote(u); return !!h && (h === d || h.endsWith(`.${d}`)); })) || null;
}

/* Les candidats que l'enregistrement de Sources vient d'ajouter, et les
   sources à envoyer sans la marque (elle ne se garde pas au référentiel). */
export function marquesCandidat(sources: Source[]): { ids: number[]; propres: Source[] } {
  const ids: number[] = [];
  const propres = sources.map((s) => {
    if (s.fromCandidate == null) return s;
    ids.push(Number(s.fromCandidate));
    const reste = { ...s };
    delete reste.fromCandidate;
    return reste;
  });
  return { ids, propres };
}

export const consequenceEcart = (c: Pick<Candidat, "domain">) =>
  `« ${c.domain} » passe dans les écartés : le scan continuera de le compter, sans le reproposer.`;
