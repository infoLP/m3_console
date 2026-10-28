import "server-only";
import { action } from "@/pont";
import * as sources from "@/api/sources.js";
import type { Fiabilite, Source } from "./gererSources.regles";

export interface ListeSources {
  sources: Source[];
  /* Par id de source ; absente pour une source inactive jamais récoltée. */
  reliability: Record<string, Fiabilite>;
  stats: { total: number; active: number; public: { total: number; active: number }; private: { total: number; active: number } };
}

export const lireSources = action<ListeSources>(sources.list);

/* M3-110 : la liste et l'instant où elle a été lue. Cet instant sert de
   référence aux états qui dépendent de l'heure (mise à l'écart en cours ou
   passée) : fixé avec les données, hors du rendu, il est le même au rendu
   serveur et à l'hydratation. */
export async function lireSourcesDatees(): Promise<ListeSources & { lueA: number }> {
  const liste = await lireSources({});
  return { ...liste, lueA: Date.now() };
}
