// Piège de focus des modales (M3-99, T3) : la règle pure, sans DOM, pour être
// testée. Tab sur le dernier élément repart au premier, Maj+Tab sur le premier
// repart au dernier ; un focus parti hors de la modale y revient. Ailleurs, le
// navigateur fait son travail : on ne prend la main que sur les bords.

export const FOCUSABLES = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Indice de l'élément à focaliser, ou null pour laisser faire le navigateur. */
export function cibleTab(n: number, actif: number, arriere: boolean): number | null {
  if (n === 0) return null;
  if (actif < 0) return arriere ? n - 1 : 0;
  if (arriere && actif === 0) return n - 1;
  if (!arriere && actif === n - 1) return 0;
  return null;
}
