import { lireNotifications } from "@/suivreNotifications/suivreNotifications.requetes";
import { ListeNotifications } from "./ListeNotifications";
import { exigerDroit } from "@/session";

export default async function PageNotifications() {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  await exigerDroit("backoffice", "/admin");
  const { notifications } = await lireNotifications({});
  return <ListeNotifications notifications={notifications} />;
}
