import { lireComptes } from "@/gererComptes/gererComptes.requetes";
import { TableauComptes } from "./TableauComptes";
import { exigerDroit } from "@/session";

export default async function PageComptes() {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  await exigerDroit("backoffice", "/admin");
  const { users } = await lireComptes({});
  return <TableauComptes initiaux={users} />;
}
