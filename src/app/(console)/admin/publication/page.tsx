import { lireEtatPublication } from "@/gererCiblesWordpress/gererCiblesWordpress.requetes";
import { TableauCibles } from "./TableauCibles";
import { exigerDroit } from "@/session";

export default async function PagePublication() {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  await exigerDroit("backoffice", "/admin");
  const etat = await lireEtatPublication({});
  return <TableauCibles initial={etat} />;
}
