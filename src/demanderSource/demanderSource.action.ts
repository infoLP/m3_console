"use server";

import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import { tenter } from "@/resultat";
import type { Demande } from "./demanderSource.regles";

const creer = action<{ ok: boolean }>(meta.createTicket);

export async function envoyerDemande(d: Demande) {
  return tenter(creer({ body: d }));
}
