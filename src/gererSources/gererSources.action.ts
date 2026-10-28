"use server";

import { action } from "@/pont";
import * as sources from "@/api/sources.js";
import { tenter, type Resultat } from "@/resultat";
import { pourEnregistrement, type ListeBlancheFurtif, type ResultatTest, type Source } from "./gererSources.regles";

const remplacer = action<{ ok: boolean; sources: Source[] }>(sources.replace);
const restaurer = action<{ total: number; active: number }>(sources.restoreBaseline);
/* 409 si un test tourne déjà sur cette source : l'erreur remonte telle quelle. */
const tester = action<ResultatTest>(sources.test);
const communes = action<{ communes: Record<string, { dept?: string; ambiguous?: boolean } | null> }>(sources.communes);
const lister = action<{ sources: Source[] }>(sources.list);
/* M3-117 : 403 hors administrateur, l'erreur remonte telle quelle. */
const listeFurtif = action<ListeBlancheFurtif>(sources.furtif);
const retirerFurtif = action<ListeBlancheFurtif & { ok: boolean }>(sources.retirerFurtif);

export async function enregistrerSources(liste: Source[]): Promise<Resultat<{ sources: Source[] }>> {
  return tenter(remplacer({ body: { sources: pourEnregistrement(liste) } }));
}

export async function restaurerReferentiel(): Promise<Resultat<{ total: number; active: number; sources: Source[] }>> {
  return tenter((async () => {
    const r = await restaurer({});
    const { sources: s } = await lister({});
    return { ...r, sources: s };
  })());
}

export async function testerSource(id: string): Promise<Resultat<ResultatTest>> {
  return tenter(tester({ params: [id] }));
}

export async function resoudreCommunes(noms: string[]) {
  return tenter(communes({ body: { names: noms } }));
}

export async function lireListeFurtif(): Promise<Resultat<ListeBlancheFurtif>> {
  return tenter(listeFurtif({}));
}

export async function retirerDuFurtif(id: string): Promise<Resultat<ListeBlancheFurtif>> {
  return tenter(retirerFurtif({ params: [id] }));
}
