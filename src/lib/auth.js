/* Authentification locale par mot de passe.

   TEMPORAIRE — en attendant le SSO Windows Entra. Le serveur est fermé au public
   et le site tourne en local ; ce module a vocation à être remplacé, pas étendu.
   Le champ `users.login` porte déjà l'UPN complet, de sorte que la bascule se
   fera par simple correspondance avec le claim `upn` / `preferred_username`.

   Hachage : `crypto.scrypt`, la primitive intégrée à Node. Argon2 serait
   préférable dans l'absolu, mais c'est un module natif : il faudrait une chaîne
   de compilation dans l'image Alpine, et le projet perdrait sa propriété
   « aucune dépendance native ». scrypt est robuste et ne coûte rien. */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query } from "./db.js";

const scryptAsync = promisify(scrypt);

/* 128 * N * r octets de mémoire, soit 16 Mo ici. Relever N durcit le hachage
   au prix du temps de connexion ; toute empreinte existante reste lisible,
   ses paramètres étant stockés avec elle. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

const SESSION_HOURS = Number(process.env.M3_SESSION_HOURS) || 12;

export async function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length < 8) {
    throw Object.assign(new Error("le mot de passe doit faire au moins 8 caractères"), { status: 400 });
  }
  const salt = randomBytes(16);
  const { N, r, p, keylen, maxmem } = SCRYPT;
  const key = await scryptAsync(plain, salt, keylen, { N, r, p, maxmem });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/* Rend toujours un booléen, y compris sur une empreinte absente ou illisible :
   l'appelant ne doit pas pouvoir distinguer « mauvais mot de passe » de
   « compte sans mot de passe ». */
export async function verifyPassword(plain, stored) {
  if (typeof plain !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  try {
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(keyB64, "base64");
    const key = await scryptAsync(plain, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/* Consomme le même temps qu'une vérification réelle, pour qu'un login inexistant
   ne se distingue pas d'un mot de passe erroné au chronomètre. */
let dummyHash = null;
export async function wasteTime(plain) {
  if (!dummyHash) dummyHash = await hashPassword("mot-de-passe-factice-pour-egaliser-les-temps");
  await verifyPassword(typeof plain === "string" ? plain : "", dummyHash);
  return false;
}

/* --------------------------------------------------------------- sessions */

export async function createSession(userId, userAgent = null) {
  const id = randomBytes(32).toString("base64url");
  await query(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval, $4)`,
    [id, userId, String(SESSION_HOURS), userAgent ? String(userAgent).slice(0, 300) : null]
  );
  return { id, maxAgeSeconds: SESSION_HOURS * 3600 };
}

/* Rend l'utilisateur de la session, ou null. Prolonge `last_seen` au passage,
   sans repousser l'expiration : une session a une durée de vie absolue. */
export async function readSession(token) {
  if (!token) return null;
  const { rows } = await query(
    `UPDATE sessions SET last_seen = now()
      WHERE id = $1 AND expires_at > now()
      RETURNING user_id`,
    [token]
  );
  if (!rows.length) return null;
  const u = await query("SELECT id, name, login, role FROM users WHERE id = $1", [rows[0].user_id]);
  return u.rows[0] || null;
}

export async function deleteSession(token) {
  if (!token) return 0;
  const { rowCount } = await query("DELETE FROM sessions WHERE id = $1", [token]);
  return rowCount;
}

/* Après un changement de mot de passe : toutes les autres sessions tombent. */
export async function deleteUserSessions(userId, exceptToken = null) {
  const { rowCount } = await query(
    "DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR id <> $2)",
    [userId, exceptToken]
  );
  return rowCount;
}

export async function pruneSessions() {
  const { rowCount } = await query("DELETE FROM sessions WHERE expires_at <= now()");
  return rowCount;
}

/* ------------------------------------------------- limitation des tentatives

   En mémoire, donc propre au processus et remis à zéro au redémarrage. Suffisant
   pour un service à un seul conteneur, fermé au public ; à revoir si l'un des
   deux cesse d'être vrai. */

const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

export function tooManyAttempts(login) {
  const e = attempts.get(String(login).toLowerCase());
  if (!e) return false;
  if (Date.now() - e.first > WINDOW_MS) { attempts.delete(String(login).toLowerCase()); return false; }
  return e.count >= MAX_ATTEMPTS;
}

export function noteFailure(login) {
  const k = String(login).toLowerCase();
  const e = attempts.get(k);
  if (!e || Date.now() - e.first > WINDOW_MS) attempts.set(k, { count: 1, first: Date.now() });
  else e.count++;
}

export function clearAttempts(login) {
  attempts.delete(String(login).toLowerCase());
}

/* ----------------------------------------------------------------- cookie */

export const COOKIE_NAME = "m3_session";

/* `Secure` n'est posé que si M3_COOKIE_SECURE=1.

   La variable est à 1 dans docker-compose.yml depuis la bascule Traefik : la
   stack ne publie aucun port, le conteneur n'est joignable que par le proxy, et
   le proxy ne sert qu'en TLS. Le drapeau n'est pas resté un réglage par
   prudence mais par nécessité : en développement local (`npm run serve`, HTTP
   sur 127.0.0.1), un cookie Secure ne serait jamais renvoyé par le navigateur —
   la connexion échouerait en boucle, sans message, chaque tentative repartant
   sur une session que le serveur n'a jamais reçue. D'où le défaut à vide ici et
   à 1 dans la stack, et non l'inverse. */
/* `SameSite=Lax` et non `Strict` depuis le raccordement Entra (M3-42).

   CE N'EST PAS UN RELÂCHEMENT DE CONFORT, c'est une nécessité du flux SSO.
   Au retour de `login.microsoftonline.com`, le navigateur arrive sur M3 par une
   navigation *cross-site* — et un cookie `Strict` n'est PAS envoyé dans ce cas.
   La session serait créée côté serveur, le cookie posé, et la personne
   reviendrait sur /console en paraissant déconnectée, renvoyée vers /login, en
   boucle et sans message. Le §5.2 du plan avait identifié le piège avant qu'on
   le rencontre.

   `Lax` reste protecteur : il bloque l'envoi du cookie sur toute requête
   cross-site AUTRE qu'une navigation GET de premier niveau — donc toujours sur
   les POST, les requêtes de formulaire et les appels d'API tiers, qui sont la
   cible du CSRF. */
export function cookieHeader(value, maxAgeSeconds) {
  const bits = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.M3_COOKIE_SECURE === "1") bits.push("Secure");
  return bits.join("; ");
}

export function readCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE_NAME) return part.slice(i + 1).trim();
  }
  return null;
}
