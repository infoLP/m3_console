// /console/accueil — l'état du jour, cumulatif par rôle (M3-108, axe C7).
// Rechargé à CHAQUE ouverture (page serveur dynamique) : un onglet resté ouvert
// depuis la veille afficherait sinon l'état d'hier sans le dire.
//
// Le palier se décide ICI, côté serveur, sur le rôle effectif (« Voir comme »
// compris) : un palier ne lit pas, et n'envoie donc pas, les données des paliers
// au-dessus. L'écran ne reçoit que des résumés, jamais les runs bruts.

import { redirect } from "next/navigation";
import { exigerUtilisateur } from "@/session";
import { lireMoi } from "@/seConnecter/seConnecter.requetes";
import { lireExecutions } from "@/lancerExecutions/lancerExecutions.requetes";
import { lireStats } from "@/consulterSuivi/consulterSuivi.requetes";
import { lireCoutRoutines } from "@/consulterCoutRoutines/consulterCoutRoutines.requetes";
import { lireNotifications } from "@/suivreNotifications/suivreNotifications.requetes";
import { libelle } from "@/suivreNotifications/suivreNotifications.regles";
import { composerAccueil } from "@/consulterAccueil/accueil.regles.js";
import { Accueil } from "./Accueil";
import type { Nuit } from "./CetteNuit";
import type { Alerte } from "./Alertes";

export default async function PageAccueil() {
  await exigerUtilisateur("/console/accueil");
  const moi = await lireMoi({});
  /* Qui a l'Accueil se règle au back-office (home_min_role) : le serveur a tranché.
     Le CONTENU, lui, dépend du palier du rôle effectif (composerAccueil). */
  if (!moi.canSeeHome) redirect("/console");
  const a = await composerAccueil({
    role: moi.role, coutsOuverts: !!moi.feats?.coutRoutines, libelle,
    lire: { stats: () => lireStats("semaine"), executions: () => lireExecutions({}), couts: () => lireCoutRoutines({}), notifications: () => lireNotifications({}) },
  });
  return <Accueil sections={a.sections} rythme={a.rythme} nuit={a.nuit as Nuit | "indisponible" | null} couts={a.couts} alertes={a.alertes as Alerte[] | "indisponible" | null} />;
}
