"use server";

import { action } from "@/pont";
import * as wp from "@/api/wpTargets.js";
import { tenter } from "@/resultat";
import type { CiblePublique, EtatPublication, ResultatTest, Saisie } from "./gererCiblesWordpress.regles";

const lister = action<EtatPublication>(wp.targetsList);
const creerCible = action<{ ok: boolean; target: CiblePublique }>(wp.targetCreate);
const modifierCible = action<{ ok: boolean; target: CiblePublique }>(wp.targetUpdate);
const activerCible = action<{ ok: boolean; target: CiblePublique }>(wp.targetActivate);
const supprimerCible = action<{ ok: boolean; id: number; name: string }>(wp.targetRemove);
const testerCible = action<ResultatTest>(wp.targetTest);

export async function relireEtatPublication() {
  return tenter(lister({}));
}

export async function creer(saisie: Saisie) {
  return tenter(creerCible({ body: saisie }));
}

export async function modifier(id: number, saisie: Saisie) {
  return tenter(modifierCible({ params: [String(id)], body: saisie }));
}

export async function activer(id: number, active: boolean) {
  return tenter(activerCible({ params: [String(id)], body: { active } }));
}

export async function supprimer(id: number) {
  return tenter(supprimerCible({ params: [String(id)] }));
}

export async function tester(id: number) {
  return tenter(testerCible({ params: [String(id)] }));
}
