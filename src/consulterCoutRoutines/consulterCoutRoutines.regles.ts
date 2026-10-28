// Coût des routines (M3-105) : la forme des données rendues par le serveur.
// Les règles de calcul et d'affichage sont dans coutRoutines.calcul.js, en
// JavaScript, parce que le gestionnaire serveur et ses tests les lisent aussi.

export interface EtapeRecolte { items: number; cout: null }
export interface EtapeGeneration { crees: number; cout: number | null; tokens: number; appels: number; moteur: string | null; plafond: string | null }
export interface Routine {
  id: string; origine: string; owner: string | null; at: string; fin: string | null;
  statut: "ok" | "partielle" | "echec"; erreur: string | null;
  recolte: EtapeRecolte | null; generation: EtapeGeneration | null;
}
export interface Totaux { cout: number; tokens: number; articles: number; articlesCoutConnu: number; routines: number; inconnus: number }
export interface CoutRoutines {
  routines: Routine[];
  totaux: { jour: Totaux; mois: Totaux };
  registre: { jour: { cout: number | null; tokens: number }; mois: { cout: number | null; tokens: number } } | null;
  conservees: number;
}
