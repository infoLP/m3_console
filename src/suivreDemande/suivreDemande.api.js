/* Suivre une demande (T17) — lecture côté serveur d'une ligne de `jobs`, pour
   le sondage du navigateur après un 202. Tout compte connecté peut la lire :
   le pont refuse sans session, et la réponse ne porte ni les paramètres ni
   rien d'autre que l'état, le résumé et l'erreur.

   T19c : tant que la demande n'a pas démarré, `attente` dit ce qui occupe sa
   voie (lu dans le kv moteur/etat) : une régénération attend la génération en
   cours, l'écran le dit au lieu d'un sablier muet. Type et numéro seulement. */

import { send } from "../lib/http.js";
import { getJob, lireEtatMoteur } from "../lib/demandes.js";
import { voieDe } from "../../shared/contrat.js";

export async function attenteDe(job, lireEtat = lireEtatMoteur) {
  if (job.startedAt || job.finishedAt) return null;
  const etat = await lireEtat().catch(() => ({ vivant: false }));
  const voie = voieDe(job.kind);
  const enCours = etat.voies?.[voie]?.demande || null;
  return {
    vivant: !!etat.vivant,
    voie,
    enCours: enCours && enCours.id !== job.id ? { id: enCours.id, kind: enCours.kind, depuis: enCours.depuis || null } : null,
  };
}

export async function lireDemande({ res, body }) {
  const job = await getJob(body?.id);
  if (!job) return send(res, 404, { error: "demande introuvable" });
  const { id, kind, requestedBy, requestedAt, startedAt, finishedAt, result, error } = job;
  send(res, 200, { id, kind, requestedBy, requestedAt, startedAt, finishedAt, result, error, attente: await attenteDe(job) });
}
