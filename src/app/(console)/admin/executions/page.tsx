import { lireExecutions } from "@/lancerExecutions/lancerExecutions.requetes";
import { lireCoutRoutines } from "@/consulterCoutRoutines/consulterCoutRoutines.requetes";
import { PanneauExecutions } from "./PanneauExecutions";
import { TableauCoutRoutines } from "./TableauCoutRoutines";
import { exigerDroit } from "@/session";

export default async function PageExecutions() {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  await exigerDroit("backoffice", "/admin");
  /* Coût des routines (M3-105) : null si la FEAT est fermée au rôle — le serveur
     n'a rien envoyé — ou si la lecture a échoué ; le bloc n'est alors pas monté. */
  const [r, couts] = await Promise.all([lireExecutions({}), lireCoutRoutines({}).catch(() => null)]);
  return (
    <>
      <PanneauExecutions initial={r} />
      {couts && <TableauCoutRoutines c={couts} />}
    </>
  );
}
