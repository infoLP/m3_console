"use server";

import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import { tenter } from "@/resultat";

const lire = action<{ ok: boolean }>(meta.readNotification);
const purger = action<{ ok: boolean; removed: number }>(meta.purgeReadNotifications);

export async function marquerLue(id: string) {
  return tenter(lire({ params: [id] }));
}

export async function purgerLues() {
  return tenter(purger({}));
}
