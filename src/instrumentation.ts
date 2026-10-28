// Démarrage du serveur Next.js : appelé une fois par processus, au plus tard à
// la première requête (constaté sous next dev comme sous next start) — d'où le
// secret qui authentifie l'en-tête du crochet (src/lib/clientIp.js).
//
// 1. Le crochet d'adresse (M3-44) : Next ne donne pas l'adresse de la connexion
//    à une action serveur, et ne remplit X-Forwarded-For que s'il est absent —
//    un en-tête forgé passe tel quel. Le crochet écrit l'adresse réelle de la
//    connexion dans un en-tête interne avant que Next ne voie la requête
//    (src/lib/clientIp.js). Sans lui, aucune adresse n'est jamais bannie.
// 2. Les réglages de connexion qui méritent d'être signalés AU DÉMARRAGE, et pas
//    à la première connexion : liste de proxys illisible, conflit entre
//    M3_AUTH_MODE et le booléen de connexion par mot de passe (M3-98).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installPeerHook } = await import("./lib/clientIp.js");
  installPeerHook();

  const { log } = await import("./lib/log.js");
  const { banConfigWarnings } = await import("./lib/ipBan.js");
  const { authModeWarnings } = await import("./lib/oidc.js");
  for (const message of [...banConfigWarnings(), ...authModeWarnings()]) {
    log.warn("boot", message);
  }
}
