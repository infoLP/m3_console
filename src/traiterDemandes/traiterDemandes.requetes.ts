import "server-only";
import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import type { Demande } from "./traiterDemandes.regles";

export const lireDemandes = action<{ tickets: Demande[] }>(meta.tickets);
