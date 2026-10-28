"use server";

import { action } from "@/pont";
import { tenter } from "@/resultat";
import * as api from "./suivreDemande.api.js";
import type { Demande } from "./suivreDemande.regles";

const lecture = action<Demande>(api.lireDemande);

export async function lireDemande(id: number) { return tenter(lecture({ body: { id } })); }
