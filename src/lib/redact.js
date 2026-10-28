/* Garde-fou : masque ce qui ressemble à une clé d'API avant que ça ne sorte.

   CE QUE ÇA FAIT, ET CE QUE ÇA NE FAIT PAS.
   C'est de la prévention d'accident, pas un contrôle d'accès. Le serveur doit
   déchiffrer la clé pour appeler le fournisseur : quiconque a un shell sur la
   machine peut la lire, et aucun filtre de sortie n'y changera rien (voir la
   section « Où poser la clé » du README).

   Ce que ça attrape, en revanche, c'est le cas réaliste : une régression future
   qui ajoute un champ dans une réponse sans voir qu'il embarque la clé, ou un
   message d'erreur du fournisseur qui renvoie en écho l'en-tête d'authentification
   reçu. Deux points de passage suffisent — `send()` pour les réponses HTTP,
   `llmStats.lastError` pour les journaux et les notifications.

   Les motifs sont volontairement ancrés sur des préfixes connus et exigent une
   longueur minimale : l'empreinte affichée (« sk-or…abcd ») ne doit PAS être
   masquée, sinon l'écran n'a plus rien à montrer. */

const MASK = "[clé masquée]";

/* Pré-filtre : une recherche de sous-chaîne sur toute la réponse coûte bien moins
   cher que quatre expressions régulières, et l'index des articles pèse plusieurs
   mégaoctets à chaque ouverture de la console. */
const QUICK = /sk-|AIza|Bearer |x-api-key/i;

const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g,                    // Anthropic
  /sk-[A-Za-z0-9_-]{16,}/g,                        // OpenAI, OpenRouter (sk-proj-, sk-or-v1-)
  /AIza[A-Za-z0-9_-]{30,}/g,                       // Google
  /\b(Bearer|x-api-key)(["':\s]+)[A-Za-z0-9._-]{16,}/gi, // en-tête renvoyé en écho
];

export function redact(value) {
  if (typeof value !== "string" || !QUICK.test(value)) return value;
  let out = value;
  for (const re of PATTERNS) {
    /* Seul le dernier motif a des groupes capturants ; ils préservent le nom de
       l'en-tête, masquer « Bearer » rendrait le message incompréhensible. Sur les
       motifs sans groupe, `replace` passe l'OFFSET en deuxième argument — d'où le
       test de type, et non un simple test de vérité qui prendrait 0 pour absent. */
    out = out.replace(re, (m, ...rest) =>
      typeof rest[0] === "string" ? `${rest[0]}${rest[1]}${MASK}` : MASK);
  }
  return out;
}
