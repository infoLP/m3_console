import "server-only";
import { action } from "@/pont";
import * as ipBans from "@/api/ipBans.js";
import type { ListeNoire } from "./gererListeNoire.regles";

export const lireListeNoire = action<ListeNoire>(ipBans.bansList);
