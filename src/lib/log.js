/* Journal applicatif : une ligne par événement, sur la sortie standard ET dans
   un fichier sous logs/.

   POURQUOI UN FICHIER. `docker logs` suffit tant qu'on est devant la machine,
   mais il disparaît avec le conteneur — et un `up -d --build` en recrée un. Les
   fichiers de logs/ survivent, et se relisent après coup.

   CE QUI N'Y EST PAS. Le contenu de logs/ est exclu des commits (.gitignore).
   Deux raisons : un journal d'authentification porte des adresses nominatives,
   et une trace d'erreur PostgreSQL porte DATABASE_URL, mot de passe compris. Un
   secret poussé sur GitHub reste dans l'historique même effacé ensuite. Pour
   transmettre une trace entre postes, on la joint à la main.

   La rédaction ci-dessous est une deuxième ceinture, pas la première : elle
   couvre le cas où quelque chose passe malgré tout par ici.

   ÉCRITURE NON BLOQUANTE ET SANS CONSÉQUENCE. Si logs/ n'est pas accessible en
   écriture — image en lecture seule, montage absent, disque plein — on continue
   sur la console sans jamais faire tomber une requête. Un journal n'est pas une
   fonctionnalité : il ne doit pas pouvoir casser le service qu'il observe. */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";

import { redact } from "./redact.js";

/* La racine se déduit d'ici (src/lib/), et NON de `ROOT` exporté par store.js :
   db.js journalise ses erreurs de pool, donc importer store.js créerait le cycle
   log → store → db → log. À l'exécution, `ROOT` n'est alors pas encore initialisé
   et le serveur tombe au démarrage sur « Cannot access 'ROOT' before
   initialization ». Un module de journal ne doit dépendre de rien. */
import { ROOT } from "./racine.js";
const DIR = join(ROOT, "logs");

/* Un fichier par jour ET par machine. Le nom de machine évite que deux postes
   travaillant sur le même dossier partagé n'écrivent dans le même fichier. */
const HOST = hostname().replace(/[^A-Za-z0-9_-]/g, "") || "inconnu";

/* Ce que `redact()` ne couvre pas : il vise les clés d'API, pas les URL de
   connexion ni les jetons de session. */
const EXTRA = [
  /* postgresql://user:MOTDEPASSE@hôte → le mot de passe seul est masqué, l'hôte
     et l'utilisateur restent lisibles : c'est ce qu'on cherche en débogage. */
  [/\/\/([^:/@\s]+):([^@/\s]+)@/g, "//$1:[masqué]@"],
  /* Cookie de session, sous ses deux formes usuelles. */
  [/(m3_session=)[^;\s"']+/gi, "$1[masqué]"],
  [/("?(?:password|motdepasse|secret|token)"?\s*[:=]\s*"?)[^",\s}]+/gi, "$1[masqué]"],
];

function clean(text) {
  let out = redact(String(text));
  for (const [re, by] of EXTRA) out = out.replace(re, by);
  return out;
}

/* Les écritures s'enchaînent sur une seule promesse : deux requêtes simultanées
   ne peuvent pas entrelacer leurs lignes au milieu d'un caractère. */
let queue = Promise.resolve();
let dirReady = null;
let broken = false;   // une fois l'écriture impossible, ne plus réessayer à chaque ligne

function writeLine(line) {
  if (broken) return;
  queue = queue
    .then(async () => {
      dirReady ??= mkdir(DIR, { recursive: true });
      await dirReady;
      const jour = new Date().toISOString().slice(0, 10);
      await appendFile(join(DIR, `${jour}.${HOST}.log`), line + "\n");
    })
    .catch((e) => {
      broken = true;
      /* Le chemin et l'uid dans le message (M3-46) : en conteneur, la cause usuelle
         est un ./logs de l'hôte appartenant à root alors que l'image tourne en
         `node` (uid 1000). `docker logs m3-web | grep "journal indisponible"`
         suffit alors à le voir, sans ouvrir de shell dans le conteneur. */
      const uid = typeof process.getuid === "function" ? ` uid=${process.getuid()}` : "";
      console.error(`✗ journal indisponible (${e.code || e.message}) dans ${DIR}${uid} — sortie console seulement`);
    });
}

/* `champs` est un objet plat : on le rend en clé=valeur, plus lisible qu'un JSON
   sur une ligne quand on relit le fichier dans un terminal. */
function format(niveau, portee, message, champs) {
  const parts = [new Date().toISOString(), niveau.padEnd(5), portee.padEnd(8), message];
  for (const [k, v] of Object.entries(champs || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v);
    parts.push(`${k}=${/\s/.test(s) ? JSON.stringify(s) : s}`);
  }
  return clean(parts.join(" "));
}

/* Relais (M3-81) : le journal en base s'abonne ici plutôt que d'être importé —
   ce module ne doit dépendre de rien (cf. plus haut, le cycle log → db → log).
   Un relais qui échoue est ignoré : il ne doit pas casser la ligne de journal. */
const relais = [];
export function addLogSink(fn) { relais.push(fn); }

/* Champs passés au relais, masqués comme la ligne de fichier. */
export function cleanFields(champs) {
  try { return JSON.parse(clean(JSON.stringify(champs || {}))); } catch { return {}; }
}

function emit(niveau, portee, message, champs) {
  const line = format(niveau, portee, message, champs);
  (niveau === "ERROR" || niveau === "WARN" ? console.error : console.log)(line);
  writeLine(line);
  for (const fn of relais) { try { fn(niveau, portee, message, champs); } catch { /* ignoré */ } }
}

export const log = {
  info: (portee, message, champs) => emit("INFO", portee, message, champs),
  warn: (portee, message, champs) => emit("WARN", portee, message, champs),
  error: (portee, message, champs) => emit("ERROR", portee, message, champs),
};

/* Identifiant tronqué : assez pour reconnaître un compte dans le journal, pas
   assez pour constituer un fichier d'adresses. « a.sanchez@legalprime.fr »
   devient « a.sa…@legalprime.fr ». */
export function loginCourt(login) {
  const s = String(login || "");
  const at = s.indexOf("@");
  if (at < 0) return s.slice(0, 4) + (s.length > 4 ? "…" : "");
  return s.slice(0, Math.min(4, at)) + (at > 4 ? "…" : "") + s.slice(at);
}
