import { lireListeNoire } from "@/gererListeNoire/gererListeNoire.requetes";
import { TableauListeNoire } from "./TableauListeNoire";
import { exigerDroit } from "@/session";

export default async function PageSecurite() {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  await exigerDroit("backoffice", "/admin");
  const liste = await lireListeNoire({});
  return <TableauListeNoire initiale={liste} />;
}
