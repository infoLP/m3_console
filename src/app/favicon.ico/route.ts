/* /favicon.ico — même icône que /site-icon : les navigateurs la demandent
   d'eux-mêmes, et legacy/server.js la servait déjà à cette adresse. */
import { navigation } from "@/pont";
import { serveSiteIcon } from "@/lib/siteIcon.js";

export const GET = navigation((req, res) => serveSiteIcon(req, res));
