/* Adresse IP réelle du client (M3-44, piège 1).

   Derrière Traefik, l'adresse de la connexion TCP est celle du proxy : bannir
   celle-là bannirait tout le monde d'un coup. L'adresse du client est dans
   `X-Forwarded-For` — mais cet en-tête, n'importe qui peut l'écrire. On ne le lit
   donc QUE si la connexion vient d'un proxy de confiance (M3_TRUSTED_PROXIES),
   et on le lit de droite à gauche : chaque proxy ajoute à droite l'adresse qu'il
   a vue, la partie gauche est ce que le client a bien voulu envoyer.

   Next.js ne donne pas l'adresse de la connexion à une action serveur. Il remplit
   bien `X-Forwarded-For` avec elle, mais seulement si l'en-tête est ABSENT
   (`??=` dans base-server.js) : un en-tête forgé est transmis tel quel. D'où le
   crochet ci-dessous, posé au démarrage par src/instrumentation.ts : il écrit
   l'adresse de la connexion dans un en-tête interne, en écrasant toute valeur
   venue du client, AVANT que Next ne voie la requête. Sans crochet actif, l'adresse
   est réputée inconnue — et une adresse inconnue n'est jamais bannie. */

import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { randomBytes } from "node:crypto";

/* En-tête interne : « <secret>|<adresse> ». Le secret, tiré au démarrage et
   propre au processus, prouve que la valeur vient du crochet : sans lui, une
   requête arrivée avant la pose du crochet (Next charge l'instrumentation à la
   première requête) pourrait apporter sa propre valeur. */
export const PEER_HEADER = "x-m3-peer";

const G = globalThis;

/* --------------------------------------------------------------- adresses */

/* « 203.0.113.7 », « 203.0.113.7:5123 », « [2001:db8::1]:443 »,
   « ::ffff:203.0.113.7 », « fe80::1%eth0 » → forme canonique, ou null. */
export function normalizeIp(raw) {
  let s = String(raw ?? "").trim().replace(/^"|"$/g, "");
  if (!s) return null;
  const crochets = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (crochets) s = crochets[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  s = s.replace(/%.*$/, "").toLowerCase();
  const mappe = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mappe) s = mappe[1];
  return isIP(s) ? s : null;
}

const familleDe = (ip) => (isIP(ip) === 6 ? "ipv6" : "ipv4");

/* « 10.0.0.0/8, 172.16.0.0/12, 203.0.113.7, fd00::/8 » → BlockList.
   Une entrée illisible est rendue dans `invalid`, pour être signalée au
   démarrage plutôt qu'ignorée en silence. */
export function parseIpList(raw) {
  const list = new BlockList();
  const invalid = [];
  const entries = [];
  for (const part of String(raw ?? "").split(/[\s,;]+/).filter(Boolean)) {
    const [base, bits, extra] = part.split("/");
    const ip = normalizeIp(base);
    const prefix = bits === undefined ? null : Number(bits);
    const max = ip && isIP(ip) === 6 ? 128 : 32;
    if (!ip || extra !== undefined || (prefix !== null && !(Number.isInteger(prefix) && prefix >= 0 && prefix <= max))) {
      invalid.push(part);
      continue;
    }
    if (prefix === null) list.addAddress(ip, familleDe(ip));
    else list.addSubnet(ip, prefix, familleDe(ip));
    entries.push(prefix === null ? ip : `${ip}/${prefix}`);
  }
  return { list, entries, invalid };
}

export function inList(ip, parsed) {
  const n = normalizeIp(ip);
  if (!n || !parsed) return false;
  return parsed.list.check(n, familleDe(n));
}

/* Boucle locale, réseaux privés, lien local, CGNAT, ULA : l'adresse d'un proxy,
   d'un conteneur voisin ou du réseau interne. Jamais bannie : si la liste des
   proxys de confiance est incomplète, c'est l'adresse de Traefik qui se
   présenterait ici, et la bannir fermerait le site à tout le monde. */
const RESERVEES = parseIpList(
  "127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 0.0.0.0/8 " +
  "::1/128 ::/128 fc00::/7 fe80::/10"
);
export const isReservedIp = (ip) => inList(ip, RESERVEES);

/* -------------------------------------------------------------- crochet */

/* Écrit l'adresse de la connexion dans PEER_HEADER, sur toute requête reçue par
   un serveur http/https du processus, avant ses écouteurs (donc avant Next).
   Idempotent : `next dev` peut réévaluer le module. */
export function installPeerHook() {
  if (!G.__m3PeerSecret) G.__m3PeerSecret = randomBytes(18).toString("base64url");
  for (const Serveur of [http.Server, https.Server]) {
    const proto = Serveur.prototype;
    if (proto.emit.__m3Peer) continue;
    const original = proto.emit;
    const emit = function (event, req, ...rest) {
      if (event === "request" && req && req.headers) {
        req.headers[PEER_HEADER] = `${G.__m3PeerSecret}|${normalizeIp(req.socket?.remoteAddress) || ""}`;
      }
      return original.call(this, event, req, ...rest);
    };
    emit.__m3Peer = true;
    proto.emit = emit;
  }
  G.__m3PeerHook = true;
}

export const peerHookActive = () => G.__m3PeerHook === true;

/* L'adresse écrite par le crochet, ou null si la valeur n'en vient pas. */
export function readPeer(value, secret = G.__m3PeerSecret) {
  const s = String(value ?? "");
  const i = s.indexOf("|");
  if (!secret || i < 0 || s.slice(0, i) !== secret) return null;
  return normalizeIp(s.slice(i + 1));
}

/* -------------------------------------------------------- adresse client */

export function trustedProxies(env = process.env) {
  return parseIpList(env.M3_TRUSTED_PROXIES);
}

/* `headers` : objet d'en-têtes en minuscules (req.headers du pont).
   Rend l'adresse du client, ou null si elle ne peut pas être établie. */
export function clientIp(headers, { trusted = trustedProxies(), hookActive = peerHookActive(), secret = G.__m3PeerSecret } = {}) {
  if (!hookActive) return null;
  const peer = readPeer(headers?.[PEER_HEADER], secret);
  if (!peer) return null;
  if (!inList(peer, trusted)) return peer;

  /* Connexion venue d'un proxy de confiance : on remonte la chaîne depuis la
     droite, en sautant les proxys de confiance. La première adresse qui n'en est
     pas un est le client. Une entrée illisible arrête la remontée : ce qui est à
     sa gauche n'est pas fiable, et l'on garde la dernière adresse sûre — un
     proxy de confiance, qui ne sera jamais banni. */
  const chaine = String(headers?.["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let candidat = peer;
  for (let i = chaine.length - 1; i >= 0; i--) {
    const ip = normalizeIp(chaine[i]);
    if (!ip) break;
    candidat = ip;
    if (!inList(ip, trusted)) return ip;
  }
  return candidat;
}
