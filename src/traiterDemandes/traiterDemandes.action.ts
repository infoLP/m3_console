"use server";

import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import { tenter } from "@/resultat";

const resoudre = action<{ ok: boolean }>(meta.resolveTicket);

export async function marquerTraitee(id: string) {
  return tenter(resoudre({ params: [id] }));
}
