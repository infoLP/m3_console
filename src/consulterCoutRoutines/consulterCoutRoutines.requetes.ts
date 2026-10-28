import "server-only";
import { action } from "@/pont";
import * as api from "./coutRoutines.api.js";
import type { CoutRoutines } from "./consulterCoutRoutines.regles";

/* null : FEAT fermée au rôle — le serveur n'a rien envoyé (M3-105). */
export const lireCoutRoutines = action<CoutRoutines | null>(api.coutRoutines);
