/* Chiffrement des secrets stockés en base — aujourd'hui les clés d'API LLM.

   AES-256-GCM, primitive intégrée à Node : pas de dépendance native, comme pour
   le hachage des mots de passe (`auth.js`). GCM et non CBC parce qu'il
   authentifie : un chiffré modifié dans la base est rejeté au déchiffrement au
   lieu de rendre des octets arbitraires.

   CE QUE ÇA PROTÈGE, ET CE QUE ÇA NE PROTÈGE PAS.
   Une sauvegarde `pg_dump` — que docs/passation/PASSATION-portainer.md prévoit régulière — ne
   contient plus les clés en clair. En revanche, quiconque a À LA FOIS la base et
   la variable d'environnement les lit. Ce n'est pas une barrière contre
   l'exploitant de la machine, c'est une barrière contre la fuite d'un fichier
   de sauvegarde.

   SI `M3_SECRET_KEY` EST ABSENTE, rien n'est chiffré ni déchiffré : les appels
   échouent explicitement. Le back-office refuse alors d'enregistrer une clé et
   le dit, plutôt que de la stocker en clair sans prévenir. */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "v1";           // permet une rotation de format sans ambiguïté
const IV_BYTES = 12;           // taille recommandée pour GCM
const KEY_BYTES = 32;

/* Sel fixe : on dérive une clé d'un secret déjà aléatoire, pas d'un mot de passe
   humain. Un sel par secret imposerait de le stocker à côté sans rien apporter
   ici — la dérivation ne sert qu'à accepter un secret de longueur quelconque. */
const KDF_SALT = "m3-secret-box-v1";

let cached = null;

function keyFrom(secret) {
  /* 64 hexa ou 44 base64 = 32 octets fournis tels quels : c'est la forme que
     produit `openssl rand -hex 32`, autant ne pas la réduire par une dérivation
     qui n'ajouterait rien. Tout le reste est dérivé, pour qu'une phrase de passe
     fonctionne quand même. */
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, "hex");
  const b64 = Buffer.from(secret, "base64");
  if (b64.length === KEY_BYTES && Buffer.from(b64).toString("base64").replace(/=+$/, "") === secret.replace(/=+$/, "")) return b64;
  return scryptSync(secret, KDF_SALT, KEY_BYTES);
}

/* Lue à chaque appel plutôt qu'à l'import : les outils en ligne de commande
   chargent le .env APRÈS avoir importé leurs modules. */
function key() {
  const secret = process.env.M3_SECRET_KEY;
  if (!secret) return null;
  if (!cached || cached.secret !== secret) cached = { secret, key: keyFrom(secret) };
  return cached.key;
}

export function secretsAvailable() {
  return !!process.env.M3_SECRET_KEY;
}

export const MISSING_SECRET =
  "M3_SECRET_KEY n'est pas définie : impossible de chiffrer ou de lire une clé d'API. " +
  "Générer un secret (openssl rand -hex 32) et le déclarer dans les variables " +
  "d'environnement, au même titre que POSTGRES_PASSWORD.";

export function encryptSecret(plain) {
  const k = key();
  if (!k) throw Object.assign(new Error(MISSING_SECRET), { status: 503 });
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv(ALGO, k, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [PREFIX, iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join("$");
}

/* Rend null plutôt que de jeter sur un chiffré illisible : une clé devenue
   indéchiffrable (secret changé, ligne corrompue) doit dégrader le provider en
   mock, pas empêcher le serveur de répondre. L'appelant distingue les deux cas
   par `secretsAvailable()`. */
export function decryptSecret(stored) {
  if (!stored) return null;
  const k = key();
  if (!k) return null;
  const [prefix, ivB64, tagB64, dataB64] = String(stored).split("$");
  if (prefix !== PREFIX || !ivB64 || !tagB64 || !dataB64) return null;
  try {
    const d = createDecipheriv(ALGO, k, Buffer.from(ivB64, "base64"));
    d.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([d.update(Buffer.from(dataB64, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* Empreinte affichable, calculée AVANT chiffrement et stockée à côté : c'est
   elle, et jamais la clé, que l'API renvoie. Forme reprise de la capture
   LibreChat — « sk-or-…2b69 ». */
export function hintOf(plain) {
  const s = String(plain || "");
  if (s.length < 8) return "…";
  return `${s.slice(0, 5)}…${s.slice(-4)}`;
}
