import "server-only";
import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import { journalQuery, type Filtres, type Journal } from "./consulterJournal.regles";

const lister = action<Journal>(meta.journalList);

export const lireJournal = (f: Filtres, cursor?: string | null) => lister({ query: journalQuery(f, cursor) });
