/* /site-icon — l'icône choisie au back-office, servie depuis la base. Sans
   session, comme la page de connexion qui l'affiche. ETag et 304 compris. */
import { navigation } from "@/pont";
import { serveSiteIcon } from "@/lib/siteIcon.js";

export const GET = navigation((req, res) => serveSiteIcon(req, res));
