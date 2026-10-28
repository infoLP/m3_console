// La racine du site ouvre la console : sur l'accueil quand le réglage du
// back-office (home_min_role) l'autorise, sur la relecture sinon — c'est le
// serveur qui a tranché (canSeeHome), comme dans l'ancien front.

import { redirect } from "next/navigation";
import { exigerUtilisateur } from "@/session";
import { lireMoi } from "@/seConnecter/seConnecter.requetes";

export default async function PageRacine() {
  await exigerUtilisateur("/");
  const moi = await lireMoi({});
  redirect(moi.canSeeHome ? "/console/accueil" : "/console");
}
