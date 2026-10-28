"use server";

import { action } from "@/pont";
import * as ipBans from "@/api/ipBans.js";
import { tenter } from "@/resultat";
import type { ListeNoire } from "./gererListeNoire.regles";

const lister = action<ListeNoire>(ipBans.bansList);
const bannirIp = action<{ ok: boolean; ip: string }>(ipBans.banIp);
const debannirIp = action<{ ok: boolean; ip: string; removed: boolean }>(ipBans.unbanIp);

export async function relireListeNoire() {
  return tenter(lister({}));
}

export async function bannir(ip: string, note: string) {
  return tenter(bannirIp({ body: { ip, note } }));
}

export async function debannir(ip: string) {
  return tenter(debannirIp({ params: [ip] }));
}
