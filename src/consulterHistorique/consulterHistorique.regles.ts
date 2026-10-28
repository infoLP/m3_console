// Règles pures de l'onglet Historique : catégories, dates approchées, puces de
// statut, auteur. Porté de legacy/scripts/history.js.

import { STATUSES, ROLES } from "@shared/model.js";
import type { CSSProperties } from "react";

/* Fiche d'un article effacé (T14), en consultation seule. Les noms valent null
   quand le rôle ne peut pas voir les auteurs. */
export interface DecisionFiche { status: string; at?: string | null; byId?: string | null; byName?: string | null; byLogin?: string | null; byRole?: string | null; auto?: boolean }
export interface FicheEffacee {
  sourceUrl?: string | null;
  itemKey?: string | null;
  sourcePublishedAt?: string | null;
  publishedAt?: string | null;
  archivedAt?: string | null;
  purgedAt?: string | null;
  purgedBy?: string | null;
  erasedAt?: string | null;
  erasedBy?: string | null;
  generatedBy?: string | null;
  decisions: DecisionFiche[];
  regenAllowed?: boolean;
}

export interface LigneHistorique {
  id: string;
  uuid?: string | null;
  title?: string;
  status: string;
  purgedFrom?: string | null;
  cat?: string;
  zone?: { num?: string; dept?: string; commune?: string; region?: string; regionOnly?: boolean };
  sourceLabel?: string;
  sourceKind?: string;
  harvestedAt?: string | null;
  createdAt?: string | null;
  decidedAt?: string | null;
  decidedBy?: string | null;
  decidedByRole?: string | null;
  scheduledAt?: string | null;
  legacy?: boolean;
  fiche?: FicheEffacee;
}

export interface Historique {
  items: LigneHistorique[];
  total: number;
  counts: Record<string, number>;
  nextCursor: string | null;
  canSeeAuthors: boolean;
  /** M3-97 : faux sous le seuil de la FEAT — le serveur n'a alors envoyé aucun purgé. */
  canSeePurged?: boolean;
}

export const CATEGORIES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "", label: "Tout" }, { key: "publie", label: "Publiés" }, { key: "valide", label: "En attente de parution" }, { key: "archive", label: "Archivés" }, { key: "purge", label: "Purgés" },
];

/* Le filtre « Purgés » n'existe que pour qui voit les purgés (M3-97). Absent de
   la réponse = ancien serveur : on garde l'écran d'avant. */
export const categoriesVisibles = (canSeePurged: boolean | undefined) =>
  canSeePurged === false ? CATEGORIES.filter((k) => k.key !== "purge") : CATEGORIES;

const STATUTS = STATUSES as Record<string, { label: string }>;
const ROLE = ROLES as Record<string, string>;

/* Date de récupération (M3-79) : enregistrée depuis le 13/10. Avant, lue dans
   l'identifiant (`art-AAAA-MM-JJ-…`), au jour près. */
export function harvestedOf(r: LigneHistorique): { iso: string; approx: boolean } | null {
  if (r.harvestedAt) return { iso: r.harvestedAt, approx: false };
  const m = /^art-(\d{4}-\d{2}-\d{2})-/.exec(r.id || "");
  return m ? { iso: `${m[1]}T12:00:00Z`, approx: true } : null;
}

export function jour(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
export function complet(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR");
}

export const CHIP_SKIN: Record<string, CSSProperties> = {
  publie: { color: "var(--go)", background: "var(--go-tint)" },
  valide: { color: "var(--brand)", background: "var(--brand-tint)" },
  archive: { color: "var(--ink-2)", background: "var(--surface-3)" },
  purge: { color: "var(--stop)", background: "var(--stop-tint)" },
  efface: { color: "var(--ink-3)", background: "var(--surface-2)" },
};

/* Libellé d'un statut, y compris ceux hors du modèle : purgé, effacé (T14). */
export function libelleStatut(status: string): string {
  if (status === "purge") return "Purgé";
  if (status === "efface") return "Effacé";
  if (status === "valide") return "En attente";
  return (STATUTS[status] || {}).label || status;
}

export function puceStatut(status: string, purgedFrom?: string | null): { label: string; style: CSSProperties; title?: string } {
  if (status === "purge") {
    const was = purgedFrom ? (purgedFrom === "valide" ? "en attente" : ((STATUTS[purgedFrom] || {}).label || purgedFrom).toLowerCase()) : null;
    return { label: `Purgé${was ? ` · était ${was}` : ""}`, style: CHIP_SKIN.purge, title: was ? `Statut au moment de la purge : ${was}` : undefined };
  }
  if (status === "efface") return { label: "Effacé", style: CHIP_SKIN.efface, title: "Article effacé : seule sa fiche reste, en consultation" };
  return { label: libelleStatut(status), style: CHIP_SKIN[status] || CHIP_SKIN.archive };
}

export function auteur(r: LigneHistorique, canSee: boolean): { texte: string | null; title?: string } {
  if (!canSee) return { texte: null, title: "Réservé aux profils Administrateur et Super Utilisateur" };
  /* M3-102 : décision du worker, pas d'une personne — « systeme » n'est pas un
     rôle de ROLES, on ne l'y cherche pas. */
  if (r.decidedByRole === "systeme") {
    return { texte: r.decidedBy || "Système", title: "Décision automatique : article non traité dans le délai réglé (Paramètres, section FEAT)" };
  }
  if (r.decidedBy) {
    const label = r.decidedByRole ? ROLE[r.decidedByRole] || r.decidedByRole : null;
    return { texte: r.decidedBy, title: label ? `Rôle exercé : ${label}` : undefined };
  }
  return { texte: null, title: r.legacy ? "Décision antérieure à la traçabilité : l'auteur n'a pas été enregistré" : "Auteur non enregistré" };
}

export const totalCompteurs = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/* Filtres de l'écran dans l'URL (M3-109). Valeurs par défaut omises ; une
   catégorie inconnue est ignorée. « purge » reste une catégorie valide ici : l'URL
   n'ouvre aucun droit, le serveur la remplace par « Tout » sans le droit (M3-97). */
export interface FiltresHistorique { category: string; q: string; uuid?: string }

/* Recherche par UUID (T14) : seul un UUID complet part au serveur ; la casse et
   les espaces autour d'un copier-coller sont tolérés. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidValide = (v: string | null | undefined): string | null => {
  const u = String(v ?? "").trim().toLowerCase();
  return UUID.test(u) ? u : null;
};

export function filtresHistoriqueDepuis(sp: Record<string, string | string[] | undefined>): FiltresHistorique {
  const premier = (k: string) => { const v = sp[k]; return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : ""; };
  const category = premier("category");
  const f: FiltresHistorique = { category: CATEGORIES.some((k) => k.key && k.key === category) ? category : "", q: premier("q").trim() };
  const uuid = uuidValide(premier("uuid"));
  if (uuid) f.uuid = uuid;
  return f;
}

export function paramsHistorique(f: FiltresHistorique): string {
  const p = new URLSearchParams();
  if (f.category) p.set("category", f.category);
  if (f.q.trim()) p.set("q", f.q.trim());
  const uuid = uuidValide(f.uuid);
  if (uuid) p.set("uuid", uuid);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/* Fiche d'un article effacé (T14) : les dates dans l'ordre de sa vie, chacune
   avec son auteur quand il y en a un. Une date absente n'est pas listée ; un nom
   masqué (rôle sans le droit) vaut null et n'est pas affiché. */
export interface DateFiche { libelle: string; iso: string; par?: string | null }

/* `par` est le texte affiché après la date : « par X », ou le moteur. */
const par = (v: string | null | undefined) => (v ? `par ${v}` : null);
const effaceur = (v: string | null | undefined) => (v === "auto" ? "automatique" : par(v));

export function datesFiche(r: LigneHistorique): DateFiche[] {
  const f = r.fiche;
  const h = harvestedOf(r);
  const toutes: Array<DateFiche | null> = [
    h ? { libelle: h.approx ? "Récupéré le (approché)" : "Récupéré le", iso: h.iso } : null,
    r.createdAt ? { libelle: "Généré le", iso: r.createdAt, par: f?.generatedBy ? `moteur ${f.generatedBy}` : null } : null,
    f?.sourcePublishedAt ? { libelle: "Parution de la source", iso: f.sourcePublishedAt } : null,
    f?.publishedAt ? { libelle: "Publié le", iso: f.publishedAt } : null,
    f?.archivedAt ? { libelle: "Archivé le", iso: f.archivedAt } : null,
    f?.purgedAt ? { libelle: "Purgé le", iso: f.purgedAt, par: par(f.purgedBy) } : null,
    (f?.erasedAt || r.decidedAt) ? { libelle: "Effacé le", iso: (f?.erasedAt || r.decidedAt)!, par: effaceur(f?.erasedBy) } : null,
  ];
  return toutes.filter((d): d is DateFiche => d !== null);
}

/* Chaîne des décisions : statut, date, nom et rôle — null quand masqué. */
export function chaineDecisions(f: FicheEffacee | undefined): Array<{ statut: string; iso: string | null; nom: string | null; role: string | null }> {
  return (f?.decisions || []).map((d) => ({
    statut: libelleStatut(d.status),
    iso: d.at || null,
    nom: d.byName || d.byLogin || (d.auto ? "Automatique" : null),
    role: d.byRole ? (d.byRole === "systeme" ? "Système" : ROLE[d.byRole] || d.byRole) : null,
  }));
}
