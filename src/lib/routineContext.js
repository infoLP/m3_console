/* Routine (M3-105) : une exécution de la chaîne, planifiée ou manuelle, sous le
   bail « chain ». Le bail l'ouvre (runLock.withLock), chaque run écrit pendant
   qu'elle tourne y est rangé (store.pushCollection("runs")), et à la sortie du
   bail, succès ou échec, son résumé part dans la collection « routines ».

   Pourquoi ici et pas dans la génération : la génération rend déjà son relevé
   d'usage dans le run qu'elle pousse ; le capter au passage suffit, sans toucher
   à src/generate ni à src/llm. Et ni l'ordonnanceur, ni les demandes du
   back-office, ni npm run daily n'ont à savoir qu'une routine existe : ils
   prennent le bail, comme avant.

   Ce module n'importe pas le store : le store s'inscrit au canal commun
   (routineCanal.js, surFinRoutine), ce qui évite un cycle runLock → store →
   journal. Un processus qui ne charge pas le store n'enregistre rien. */

import { randomUUID } from "node:crypto";
import { canalRoutine as als, finDeRoutine } from "./routineCanal.js";

export { surFinRoutine, routineCourante } from "./routineCanal.js";

/* « planifiee » : ordonnanceur ; « manuelle » : demande du back-office (défaut) ;
   « daily » : npm run daily ; « poste » : npm run harvest / generate à la main. */
export const ORIGINES_ROUTINE = ["planifiee", "manuelle", "daily", "poste"];

/* Une étape a échoué mais l'appelant a rattrapé l'erreur et la routine continue
   ou s'arrête proprement — l'ordonnanceur, quand la récolte échoue, ne lance pas
   la génération et ne lève rien. Sans cette marque, la routine s'afficherait
   « ok » sur un écran de coûts. Sans effet hors routine. */
export function marquerRoutinePartielle(motif) {
  const r = als.getStore();
  if (r) r.partielle = String(motif || "étape en échec").slice(0, 200);
}

export async function enRoutine({ origine = "manuelle", owner = null, now = () => Date.now() } = {}, fn) {
  /* Une routine dans une routine (n'arrive pas aujourd'hui) : l'englobante garde
     tout, plutôt que d'en compter deux pour le même argent. */
  if (als.getStore()) return fn();
  const r = {
    id: `rt-${now()}-${randomUUID().slice(0, 8)}`,
    origine: ORIGINES_ROUTINE.includes(origine) ? origine : "manuelle",
    owner, at: new Date(now()).toISOString(), runs: [],
  };
  let erreur = null;
  try {
    return await als.run(r, fn);
  } catch (e) {
    erreur = e?.message || String(e);
    throw e;
  } finally {
    try { await finDeRoutine(resumeRoutine(r, { fin: new Date(now()).toISOString(), erreur })); }
    catch (e) { console.warn(`[routine] résumé non enregistré (${e.message})`); }
  }
}

/* Résumé d'une routine à partir des runs qu'elle a écrits. Pure.
   - Récolte : aucun appel LLM (src/ingest n'en fait pas) → coût null, « — ».
   - Génération : stats.usage du run (null pour le mock, qui ne facture rien) ;
     `cost` reste null si le moteur n'en renvoie aucun (Anthropic, modèle
     gratuit) — on garde alors les tokens. */
export function resumeRoutine(r, { fin = null, erreur = null } = {}) {
  const runs = Array.isArray(r?.runs) ? r.runs : [];
  const recoltes = runs.filter((x) => x?.kind === "harvest");
  const generations = runs.filter((x) => x?.kind === "generation");
  let cout = null, tokens = 0, crees = 0, appels = 0;
  const moteurs = new Set();
  let plafond = null;
  for (const g of generations) {
    const s = g.stats || {};
    crees += Number(s.created) || 0;
    if (s.provider) moteurs.add(s.provider);
    if (s.cap && !plafond) plafond = s.cap.detail || "plafond atteint";
    const u = s.usage;
    if (!u) continue;
    appels += Number(u.billedCalls) || 0;
    tokens += Number(u.totalTokens) || 0;
    if (u.cost != null && Number.isFinite(Number(u.cost))) cout = (cout || 0) + Number(u.cost);
  }
  return {
    id: r.id, origine: r.origine, owner: r.owner || null, at: r.at, fin,
    /* « echec » : une erreur est sortie du bail ; « partielle » : une étape a
       échoué et l'appelant l'a rattrapée (marquerRoutinePartielle). */
    statut: erreur ? "echec" : r.partielle ? "partielle" : "ok", erreur: erreur || r.partielle || null,
    recolte: recoltes.length ? { items: recoltes.reduce((n, x) => n + (Number(x.stats?.items) || 0), 0), cout: null } : null,
    generation: generations.length ? { crees, cout, tokens, appels, moteur: [...moteurs].join(", ") || null, plafond } : null,
  };
}
