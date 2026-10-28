// Préférences de poste de la console et raccourcis clavier : ce qui se règle,
// et comment une touche s'affiche. Les règles de résolution et de validation
// des touches sont dans shared/shortcuts.js (partagées avec le serveur).

import { resolveShortcuts, validerTouche, normKey } from "@shared/shortcuts.js";

export interface ActionClavier {
  id: string; label: string; touche: string; alt?: string; actif: boolean;
  bornePar: string | null; coupe: boolean; arme: boolean; conflit?: string; decision: boolean; risque: boolean;
}
export interface Raccourcis { actions: ActionClavier[]; parTouche: Map<string, string>; actifGlobal: boolean }

export interface PrefsClavier { keys?: Record<string, string>; keysOff?: string[]; keysEnabled?: boolean; [autre: string]: unknown }

export const raccourcis = (bornes: Record<string, string> | undefined, prefs: PrefsClavier): Raccourcis =>
  resolveShortcuts(bornes || {}, prefs) as Raccourcis;

/* Le libellé d'une touche, pour l'aide-mémoire et l'écran de réglage. */
export function libelleTouche(a: ActionClavier): string {
  const t = String(a.touche).toUpperCase();
  return a.alt === "ArrowDown" ? `${t} · ↓` : a.alt === "ArrowUp" ? `${t} · ↑` : t;
}

export function etatTouche(a: ActionClavier): string {
  return a.bornePar ? `indisponible — ${a.bornePar}` : a.coupe ? "désactivé dans vos préférences" : a.conflit ? "touche en conflit" : a.arme ? " — deux frappes" : "";
}

export { validerTouche, normKey };

export const SAISIE = new Set(["INPUT", "TEXTAREA", "SELECT"]);
export const saisieEnCours = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || SAISIE.has(el.tagName));
};

/* Délai d'armement d'une action irréversible : assez pour confirmer sciemment,
   trop court pour qu'une frappe oubliée se combine avec une autre plus tard. */
export const ARMEMENT_MS = 4000;
