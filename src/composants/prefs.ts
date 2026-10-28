// Préférences de poste (localStorage « m3:prefs »), partagées par la console
// et le back-office : thème, navigation repliée, sections de réglages repliées… On lit et on fusionne, pour ne jamais effacer ce que la
// console y range aussi (départements, touches, FEAT).
//
// usePrefs() les expose aux composants par useSyncExternalStore : le serveur
// rend les défauts, le navigateur relit le stockage à l'hydratation, et une
// écriture prévient tous les abonnés — sans setState dans un effet.

import { useSyncExternalStore } from "react";

const CLE = "m3:prefs";

export interface Prefs {
  theme: "auto" | "dark" | "light" | string;
  navFolded: boolean;
  settingsFolded: string[];
  /* Groupes du rail ouverts (true) ou repliés (false) par l'utilisateur, par
     jour de génération « AAAA-MM-JJ ». Un jour absent suit le défaut : seul
     le plus récent est ouvert. */
  railJours: Record<string, boolean>;
  [autre: string]: unknown;
}

const DEFAUT: Prefs = { theme: "auto", navFolded: false, settingsFolded: [], railJours: {} };

let cache: Prefs | null = null;
const abonnes = new Set<() => void>();

export function lirePrefs(): Prefs {
  if (cache) return cache;
  try {
    cache = { ...DEFAUT, ...(JSON.parse(localStorage.getItem(CLE) || "{}") as Partial<Prefs>) };
  } catch {
    cache = { ...DEFAUT };
  }
  return cache;
}

export function ecrirePrefs(patch: Partial<Prefs>): Prefs {
  const p = { ...lirePrefs(), ...patch };
  try { localStorage.setItem(CLE, JSON.stringify(p)); } catch { /* stockage indisponible : la préférence vaut pour la page */ }
  cache = p;
  abonnes.forEach((f) => f());
  return p;
}

function abonner(f: () => void) {
  abonnes.add(f);
  /* Un autre onglet (console ↔ back-office) a changé la préférence. */
  const surStockage = (e: StorageEvent) => { if (e.key === CLE) { cache = null; f(); } };
  window.addEventListener("storage", surStockage);
  return () => { abonnes.delete(f); window.removeEventListener("storage", surStockage); };
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(abonner, lirePrefs, () => DEFAUT);
}

/* Sombre seulement si demandé
   ET si la FEAT « mode sombre » est ouverte à ce rôle (M3-83). */
export function appliquerTheme(feats: { dark?: boolean } = {}) {
  const dark = lirePrefs().theme === "dark" && feats.dark !== false;
  document.documentElement.dataset.theme = dark ? "dark" : "";
}
