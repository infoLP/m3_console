import "server-only";
import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import type { Compte } from "./gererComptes.regles";

export const lireComptes = action<{ users: Compte[] }>(meta.users);
