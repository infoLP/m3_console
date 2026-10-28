// Mise en page de la relecture (M3-107, axe C2) : où vont la file et le panneau
// détaillé selon la largeur d'écran. Mêmes seuils que le Tiroir du socle
// (SEUILS_TIROIR) ; les media queries de styles/console.css les reprennent
// (1000 px et 1401 px).
//   - sous 1000 px (demi-écran, le cas dimensionnant) : file et détail en tiroir,
//     l'article prend toute la largeur ;
//   - de 1000 à 1400 px : la file tient en colonne étroite (l'article garde
//     au moins ~560 px, la largeur de sa prose), le détail reste en tiroir ;
//   - au-delà : trois colonnes, file · article · détail toujours visible.

import { CRITERIA } from "@shared/scoring.js";
import { SEUILS_TIROIR } from "@/composants/Tiroir.logique";

export type Place = "tiroir" | "colonne";
export type Disposition = { file: Place; detail: Place };

export function disposition(largeurEcran: number): Disposition {
  if (largeurEcran < SEUILS_TIROIR.plein) return { file: "tiroir", detail: "tiroir" };
  if (largeurEcran <= SEUILS_TIROIR.demi) return { file: "colonne", detail: "tiroir" };
  return { file: "colonne", detail: "colonne" };
}

/* Sections du panneau détaillé, dans l'ordre d'affichage. « preuves » (le
   pourquoi, worker C2) et « relances » (worker C4) sont des emplacements. */
export const SECTIONS_DETAIL = ["preuves", "conformite", "relances", "relecture", "rattachement", "parametres", "source", "illustration", "seo"] as const;
export type SectionDetail = (typeof SECTIONS_DETAIL)[number];

/** Où ouvrir le panneau : une section, et pour les preuves un critère précis. */
export type CibleDetail = { section: SectionDetail; critere?: string };

export const ancreDetail = (section: SectionDetail) => `cr-detail-${section}`;
/** Ancre d'un critère dans la section Preuves : celle que pose <Preuves> (idPreuve, worker C2). */
export const ancrePreuve = (critere: string) => `preuve-${critere}`;

/** Les ancres à essayer, de la plus précise à la plus large. */
export function ancresCible(cible: CibleDetail): string[] {
  const liste = cible.section === "preuves" && cible.critere ? [ancrePreuve(cible.critere)] : [];
  return [...liste, ancreDetail(cible.section)];
}

export type Pastille = { cle: string; libelle: string; ok: boolean };
type ResultatsCriteres = { lengthOK: boolean; rankOK: boolean; sourceOK: boolean; illoOK: boolean; seoOK: boolean };

/** Les cinq critères de analyze(), dans l'ordre de CRITERIA, pour la barre. */
export function pastillesConformite(A: ResultatsCriteres): Pastille[] {
  const ok: Record<string, boolean> = { longueur: A.lengthOK, ranking: A.rankOK, source: A.sourceOK, illustration: A.illoOK, seo: A.seoOK };
  return (CRITERIA as [string, string][]).map(([cle, libelle]) => ({ cle, libelle, ok: !!ok[cle] }));
}
