/* Coût des routines (M3-105) — lecture côté serveur.

   La FEAT « Coût des routines » est tenue ICI : sous son seuil, la réponse est
   `null` et aucune routine ne part vers le navigateur. L'écran ne fait que ne
   rien afficher quand il reçoit `null` ; il ne protège rien. Tant que la FEAT
   n'est pas déclarée (shared/feats.js), elle compte comme fermée.

   Totaux : la somme des routines (cohérente avec le tableau), et en dessous la
   dépense LLM totale du registre (kv KV_DEPENSES_LLM, tenue par le moteur),
   qui compte aussi les régénérations et relectures faites hors routine (choix
   de l'utilisateur). La console la lit en base, sans importer le moteur (T24). */

import { send } from "../lib/http.js";
import { readJson, readRoutines } from "../lib/store.js";
import { readSettings } from "../lib/yamlStore.js";
import { KV_DEPENSES_LLM, periodKeys } from "../../shared/contrat.js";
import { ROUTINES_AFFICHEES, totaux, coutRoutinesOuvert } from "./coutRoutines.calcul.js";
export { coutRoutinesOuvert, masquerCouts } from "./coutRoutines.calcul.js";

export async function coutRoutines({ res, role, now = Date.now() }) {
  if (!coutRoutinesOuvert(role, await readSettings())) return send(res, 200, null);
  const routines = await readRoutines();
  let registre = null;
  try {
    const l = await readJson(KV_DEPENSES_LLM, null);
    const { day, month } = periodKeys(now);
    const pick = (u) => (u ? { cout: u.cost ?? null, tokens: u.totalTokens || 0 } : { cout: 0, tokens: 0 });
    registre = { jour: pick(l?.days?.[day]), mois: pick(l?.months?.[month]) };
  } catch { /* registre illisible : les totaux des routines restent, le bloc le dit */ }
  send(res, 200, {
    routines: routines.slice(0, ROUTINES_AFFICHEES),
    totaux: totaux(routines, now, periodKeys),
    registre,
    conservees: routines.length,
  });
}
