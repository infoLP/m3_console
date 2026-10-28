import { pathToFileURL } from "node:url";

/* true si le module courant est lancé directement (node src/x.js). */
export function isMain(importMetaUrl) {
  try {
    return importMetaUrl === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}
