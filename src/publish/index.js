/* Aiguillage de la publication : simulée (défaut) ou WordPress réel, selon le
   réglage `publish_mode` / M3_PUBLISH_MODE (cf. wpConfig.js). Les deux
   publishers ont la même signature et la même charge utile (payload.js).

   À la fusion, src/api/articles.js importera `publish` d'ici plutôt que de
   simulated.js : c'est le seul changement nécessaire hors de src/publish/. */

import { publish as publishSimulated } from "./simulated.js";
import { publish as publishWordpress } from "./wordpress.js";
import { readPublishMode } from "./wpConfig.js";

export function publisherFor(settings = {}, env = process.env) {
  return readPublishMode(settings, env) === "wordpress" ? publishWordpress : publishSimulated;
}

export async function publish(article, settings, opts = {}) {
  return publisherFor(settings, opts.env)(article, settings, opts);
}
