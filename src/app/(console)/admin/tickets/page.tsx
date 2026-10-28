import { lireDemandes } from "@/traiterDemandes/traiterDemandes.requetes";
import { ListeDemandes } from "./ListeDemandes";
import { exigerDroit } from "@/session";

export default async function PageDemandes() {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  await exigerDroit("backoffice", "/admin");
  const { tickets } = await lireDemandes({});
  return <ListeDemandes demandes={tickets} />;
}
