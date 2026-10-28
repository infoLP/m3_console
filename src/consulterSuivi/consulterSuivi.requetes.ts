import "server-only";
import { action } from "@/pont";
import * as ops from "@/api/ops.js";
import type { Stats } from "./consulterSuivi.regles";

const lire = action<Stats>(ops.stats);
export const lireStats = (range = "semaine") => lire({ query: { range } });
