/* Canal des routines (M3-105), sorti de routineContext.js au lot 2 du découpage
   (T18) : le store, code commun, y lit la routine en cours et s'y inscrit pour
   en recevoir le résumé, sans importer le moteur. routineContext.js (moteur)
   ouvre les routines dans ce canal. Côté console, personne ne l'ouvre :
   routineCourante() rend null, « pas de routine ». */

import { AsyncLocalStorage } from "node:async_hooks";

export const canalRoutine = new AsyncLocalStorage();
let enregistreur = null;

export function surFinRoutine(cb) { enregistreur = cb; }
export const routineCourante = () => canalRoutine.getStore() || null;

/* Remet le résumé d'une routine terminée à qui s'est inscrit (le store). */
export async function finDeRoutine(resume) {
  if (enregistreur) await enregistreur(resume);
}
