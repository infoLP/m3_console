"use server";

import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import { tenter } from "@/resultat";
import type { Icone, Valeurs } from "./gererReglages.regles";

type Reponse = { ok: boolean; settings: Record<string, unknown>; stored: string[] };

const enregistrer = action<Reponse>(meta.saveSettings);
const remettre = action<Reponse & { removed: string[] }>(meta.resetSettings);
const poserIcone = action<{ ok: boolean }>(meta.saveSiteIcon);
const lireIcone = action<{ icon: Icone | null }>(meta.siteIcon);
const retirer = action<{ ok: boolean }>(meta.removeSiteIcon);

export async function enregistrerReglages(patch: Valeurs) {
  return tenter(enregistrer({ body: patch }));
}

/* « Revenir au défaut » (M3-109, B2) : supprime la ligne en base, le réglage
   reprend la valeur du moteur. */
export async function revenirAuDefaut(cle: string) {
  return tenter(remettre({ body: { keys: [cle] } }));
}

/* Hors du formulaire : l'icône part dès le fichier choisi, sans attendre
   « Enregistrer ». Les bornes sont revérifiées au serveur, qui seul fait foi. */
export async function enregistrerIcone(dataUrl: string) {
  return tenter(poserIcone({ body: { dataUrl } }).then(() => lireIcone({})));
}

export async function retirerIcone() {
  return tenter(retirer({}));
}
