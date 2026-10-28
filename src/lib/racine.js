/* La racine du dépôt, pour tout ce qui lit un fichier par chemin : config/
   (baselines), logs/.

   Un seul endroit, sans aucun import local, parce que log.js en a besoin et que
   store.js importe (via journal.js et db.js) log.js : le mettre dans store.js
   ferait un cycle.

   Déduite de l'emplacement de ce fichier — sauf quand il a été empaqueté par
   Next.js (V2 de docs/plans/PLAN-nextjs-migration.md) : import.meta.url peut alors pointer
   dans .next/ et « ../.. » ne mène nulle part. On le détecte à l'absence de
   package.json, et on retombe sur le répertoire courant, qui est la racine en
   Docker (WORKDIR /app) comme avec `npm run`.

   Pas de `new URL("../..", import.meta.url)` : Turbopack y voit une ressource à
   empaqueter et refuse de résoudre un dossier. `fileURLToPath(import.meta.url)`
   seul passe. */

import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function devine() {
  try {
    const ici = dirname(fileURLToPath(import.meta.url));
    const r = resolve(ici, "..", "..");
    if (existsSync(join(r, "package.json"))) return r;
  } catch { /* import.meta.url illisible : on retombe sur cwd */ }
  return process.cwd();
}

export const ROOT = devine();
