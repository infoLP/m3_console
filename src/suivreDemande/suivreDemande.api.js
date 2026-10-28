/* Suivre une demande (T17) — lecture côté serveur d'une ligne de `jobs`, pour
   le sondage du navigateur après un 202. Tout compte connecté peut la lire :
   le pont refuse sans session, et la réponse ne porte ni les paramètres ni
   rien d'autre que l'état, le résumé et l'erreur. */

import { send } from "../lib/http.js";
import { getJob } from "../lib/demandes.js";

export async function lireDemande({ res, body }) {
  const job = await getJob(body?.id);
  if (!job) return send(res, 404, { error: "demande introuvable" });
  const { id, kind, requestedBy, requestedAt, startedAt, finishedAt, result, error } = job;
  send(res, 200, { id, kind, requestedBy, requestedAt, startedAt, finishedAt, result, error });
}
