// Lectures de la tranche « se connecter » : qui est là, avec quels droits.
// Par le pont, sur le handler GET /api/me existant.

import "server-only";
import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import type { Moi } from "./seConnecter.regles";

export type { Moi };
export const lireMoi = action<Moi>(meta.me);
