/* /api/health — santé du service (M3-108). Route OUVERTE sans session (cf.
   OUVERTES dans src/pont.ts) : le HEALTHCHECK du conteneur l'interroge sans
   cookie et ne lit que le statut (200 / 503) et `ok`. Le détail suit le niveau
   de qui demande — sans session : état et référence ; connecté : base,
   migrations, tables ; administrateur : configuration en oui/non. Le filtrage
   est dans src/diagnostiquerService/sante.regles.js. */
import { route } from "@/pont";
import * as sante from "@/diagnostiquerService/sante.js";

export const GET = route(sante.sante);
