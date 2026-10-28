import "server-only";
import { action } from "@/pont";
import * as wp from "@/api/wpTargets.js";
import type { EtatPublication } from "./gererCiblesWordpress.regles";

export const lireEtatPublication = action<EtatPublication>(wp.targetsList);
