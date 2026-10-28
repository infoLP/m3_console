/* Réception des erreurs remontées par le navigateur (cf. scripts/clientLog.js).
 *
 * OUVERTE SANS SESSION, volontairement : les pannes les plus opaques sont celles
 * de la page de connexion, où il n'y a par définition pas de session. Le prix à
 * payer est un point d'entrée d'écriture non authentifié, d'où les limites
 * ci-dessous — un journal doit rester lisible, et ne doit jamais devenir le
 * moyen de saturer le disque.
 */

import { send } from "../lib/http.js";
import { log, loginCourt } from "../lib/log.js";

/* Fenêtre glissante grossière : on ne cherche pas à repousser un attaquant
   déterminé — le service est derrière une authentification pour tout le reste —
   mais à borner une boucle de rendu défaillante, ou un onglet laissé ouvert. */
const FENETRE_MS = 60_000;
const PAR_FENETRE = 60;
let debut = Date.now();
let compte = 0;

const borne = (v, n) => (v == null ? undefined : String(v).slice(0, n));

export async function receive({ res, body, user, req }) {
  const maintenant = Date.now();
  if (maintenant - debut > FENETRE_MS) { debut = maintenant; compte = 0; }
  if (++compte > PAR_FENETRE) {
    /* Silencieux côté client : répondre 429 déclencherait chez lui une nouvelle
       erreur, donc un nouvel envoi. On accepte et on jette. */
    return send(res, 204, "");
  }
  if (compte === PAR_FENETRE) {
    log.warn("client", "plafond atteint", { fenetre_s: FENETRE_MS / 1000, plafond: PAR_FENETRE });
  }

  log.error("client", borne(body?.type, 20) || "erreur", {
    message: borne(body?.message, 400),
    page: borne(body?.page, 200),
    source: borne(body?.source, 300),
    ligne: body?.ligne,
    colonne: body?.colonne,
    /* L'identifiant du compte vient de la session côté serveur, jamais du corps
       de la requête : la route étant ouverte, rien de ce qu'elle reçoit ne peut
       servir à désigner quelqu'un. */
    qui: user ? loginCourt(user.login) : undefined,
    agent: borne(body?.agent, 200),
    pile: borne(body?.pile, 2000),
  });

  send(res, 204, "");
}
