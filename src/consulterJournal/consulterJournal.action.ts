"use server";

import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import { tenter } from "@/resultat";
import { journalQuery, type Filtres, type Journal } from "./consulterJournal.regles";

const lister = action<Journal>(meta.journalList);

/* « Charger la suite » : la page suivante, pour les mêmes filtres. */
export async function chargerSuite(f: Filtres, cursor: string) {
  return tenter(lister({ query: journalQuery(f, cursor) }));
}
