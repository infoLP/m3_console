// /console/suivi — réservé au droit view_stats, évalué sur le rôle effectif
// (un « Voir comme » relecteur n'y a pas accès, comme avant).

import { redirect } from "next/navigation";
import { can } from "@shared/model.js";
import { exigerUtilisateur, roleEffectif } from "@/session";
import { lireStats } from "@/consulterSuivi/consulterSuivi.requetes";
import { Suivi } from "./Suivi";

export default async function PageSuivi() {
  const u = await exigerUtilisateur("/console/suivi");
  if (!can(await roleEffectif(u), "view_stats")) redirect("/console");
  const initial = await lireStats("semaine");
  return <Suivi initial={initial} />;
}
