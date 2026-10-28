// Largeur du Tiroir selon la largeur d'écran (décision 4) : sous 1000 px plein
// écran, de 1000 à 1400 px demi-écran, au-delà largeur « confortable » fixe.

export type FormatTiroir = "plein" | "demi" | "confortable";

export const SEUILS_TIROIR = { plein: 1000, demi: 1400 } as const;

export function formatTiroir(largeurEcran: number): FormatTiroir {
  if (largeurEcran < SEUILS_TIROIR.plein) return "plein";
  if (largeurEcran <= SEUILS_TIROIR.demi) return "demi";
  return "confortable";
}
