"use server";

import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import * as auth from "@/api/auth.js";
import { tenter } from "@/resultat";
import type { Compte } from "./gererComptes.regles";

const enregistrer = action<{ ok: boolean; users: Compte[] }>(meta.saveUsers);
const motDePasse = action<{ ok: boolean; login: string; sessionsFermees: number }>(auth.setUserPassword);

export async function enregistrerComptes(users: Compte[]) {
  return tenter(enregistrer({ body: { users } }));
}

export async function definirMotDePasse(id: string, password: string) {
  return tenter(motDePasse({ params: [id], body: { password } }));
}
