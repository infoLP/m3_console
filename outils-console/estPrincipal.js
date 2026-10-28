/* true si le module courant est lancé directement (node outils-console/x.js).
   Recopié de src/lib/main.js du moteur (T26) : cette lib reste au moteur, les
   outils de la console n'en ont besoin que de ces quelques lignes. */

import { pathToFileURL } from "node:url";

export function isMain(importMetaUrl) {
  try {
    return importMetaUrl === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}
