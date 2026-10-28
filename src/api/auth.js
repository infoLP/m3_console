/* Connexion / déconnexion. Temporaire, en attendant le SSO Windows Entra. */

import { send } from "../lib/http.js";
import { query } from "../lib/db.js";
import {
  verifyPassword, wasteTime, createSession, deleteSession, deleteUserSessions,
  hashPassword, cookieHeader, readCookie, COOKIE_NAME,
  tooManyAttempts, noteFailure, clearAttempts,
} from "../lib/auth.js";
import { localEnabled } from "../lib/oidc.js";
import { ROLES, PERMISSIONS } from "../../shared/model.js";
import { log, loginCourt } from "../lib/log.js";
import { journalCompte } from "../lib/journal.js";
import { attemptLabel } from "../lib/ipBan.js";
import { ipBans, requestIp } from "./ipBans.js";

const publicUser = (u) => ({
  id: u.id, name: u.name, login: u.login, role: u.role,
  roleLabel: ROLES[u.role], permissions: PERMISSIONS[u.role],
});

export async function login({ res, body, req }) {
  /* Mode `entra` : le mot de passe n'est plus une façon d'entrer, et la route ne
     doit pas rester ouverte parce que la page de connexion, elle, a cessé
     d'afficher le formulaire. Masquer un champ n'est pas fermer une porte.
     `localEnabled()` reste vrai tant qu'Entra n'est pas réellement configuré :
     une variable mal posée ne peut pas verrouiller le site (§5.4 du plan). */
  if (!localEnabled()) {
    log.warn("auth", "refus", { motif: "mode_entra" });
    return send(res, 403, { error: "la connexion par mot de passe est désactivée" });
  }

  const login = String(body?.login || "").trim();
  const password = String(body?.password || "");
  if (!login || !password) {
    log.warn("auth", "refus", { login: loginCourt(login), motif: "champs_manquants" });
    return send(res, 400, { error: "identifiant et mot de passe requis" });
  }

  /* Liste noire (M3-44), AVANT tout : une adresse bannie n'apprend même plus si
     son mot de passe est bon. Une base qui ne répond pas sur cette table ne doit
     pas fermer la connexion à tout le monde : la mesure est une défense en
     profondeur, pas la porte. */
  const ip = requestIp(req);
  let bannie = false;
  try { bannie = Boolean(ip) && await ipBans.isBanned(ip); } catch (e) {
    log.error("auth", "liste noire illisible", { erreur: e.message });
  }
  if (bannie) {
    log.warn("auth", "refus", { login: loginCourt(login), ip, motif: "ip_bannie" });
    return send(res, 403, { error: "connexion refusée depuis cette adresse : contactez l'administrateur" });
  }

  if (tooManyAttempts(login)) {
    await noterRefusIp(ip, attemptLabel(login));
    log.warn("auth", "refus", { login: loginCourt(login), motif: "trop_de_tentatives" });
    return send(res, 429, { error: "trop de tentatives, réessayez dans quelques minutes" });
  }

  const { rows } = await query(
    "SELECT id, name, login, role, password_hash FROM users WHERE lower(login) = lower($1)",
    [login]
  );
  const u = rows[0];

  /* Sans compte, on consomme le même temps qu'une vérification réelle : un login
     inexistant ne doit pas se distinguer d'un mot de passe erroné au chronomètre. */
  const okPwd = u && u.password_hash
    ? await verifyPassword(password, u.password_hash)
    : await wasteTime(password);

  if (!okPwd) {
    noteFailure(login);
    await noterRefusIp(ip, attemptLabel(login, { knownAccount: Boolean(u) }));
    /* Le motif réel n'est écrit QUE dans le journal. La réponse HTTP, elle, reste
       volontairement indistincte (cf. ci-dessous) : c'est tout l'intérêt d'avoir
       un journal côté serveur — diagnostiquer sans rien dire à l'appelant. */
    log.warn("auth", "refus", {
      login: loginCourt(login),
      motif: !u ? "compte_introuvable"
        : !u.password_hash ? "aucun_mot_de_passe_defini"
        : "mot_de_passe_incorrect",
    });
    /* Message unique, volontairement : ne pas révéler si le compte existe, ni
       s'il est simplement dépourvu de mot de passe. */
    return send(res, 401, { error: "identifiant ou mot de passe incorrect" });
  }

  clearAttempts(login);
  if (ip) ipBans.recordSuccess(ip).catch(() => {});
  const s = await createSession(u.id, req.headers["user-agent"]);
  res.setHeader("Set-Cookie", cookieHeader(s.id, s.maxAgeSeconds));
  log.info("auth", "connexion", { login: loginCourt(u.login), role: u.role });
  journalCompte("connexion", u, { user: u });
  send(res, 200, { ok: true, user: publicUser(u) });
}

/* Un refus de plus pour l'adresse ; au seuil, elle est bannie (notification et
   journal : src/api/ipBans.js). Jamais bloquant pour la réponse. */
async function noterRefusIp(ip, label) {
  if (!ip) return;
  try {
    const r = await ipBans.recordFailure(ip, label);
    if (r.banned) log.warn("auth", "refus", { ip, motif: "seuil_atteint", refus: r.count });
  } catch (e) {
    log.error("auth", "liste noire : refus non compté", { erreur: e.message });
  }
}

/* Santé du service, pour le HEALTHCHECK du conteneur. Accessible SANS session :
   /api/me répondait 200 avant l'authentification et servait à cela, mais il répond
   401 désormais — le conteneur serait marqué unhealthy en permanence.
   La requête touche la base : un PostgreSQL injoignable doit se voir. */
export async function health({ res }) {
  try {
    await query("SELECT 1");
    send(res, 200, { ok: true });
  } catch {
    send(res, 503, { ok: false });
  }
}

export async function logout({ res, req, user }) {
  await deleteSession(readCookie(req));
  if (user) {
    log.info("auth", "déconnexion", { login: loginCourt(user.login) });
    journalCompte("déconnexion", user, { user });
  }
  /* Mêmes attributs que la pose (cf. cookieHeader) : un cookie ne s'efface que
     si l'en-tête qui l'annule le décrit à l'identique. */
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  send(res, 200, { ok: true });
}

/* Changement de son propre mot de passe. Exige l'ancien : un poste laissé
   déverrouillé ne doit pas suffire à verrouiller le compte de son occupant. */
export async function changePassword({ res, req, body, user }) {
  if (!user) return send(res, 401, { error: "authentification requise" });
  const current = String(body?.current || "");
  const next = String(body?.next || "");

  const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
  if (!rows.length || !(await verifyPassword(current, rows[0].password_hash))) {
    return send(res, 403, { error: "mot de passe actuel incorrect" });
  }
  let hash;
  try {
    hash = await hashPassword(next);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  await query("UPDATE users SET password_hash = $2, password_set_at = now() WHERE id = $1", [user.id, hash]);
  /* Les autres sessions tombent — celle en cours est conservée. */
  const killed = await deleteUserSessions(user.id, readCookie(req));
  log.info("auth", "mot de passe changé", { login: loginCourt(user.login), sessions_fermees: killed });
  journalCompte("mot de passe changé", user, { user, detail: { sessions_fermees: killed } });
  send(res, 200, { ok: true, sessionsFermees: killed });
}

/* Attribution d'un mot de passe par l'administrateur, depuis le back-office. */
export async function setUserPassword({ res, params, body, role }) {
  if (!PERMISSIONS[role]?.manage_users) return send(res, 403, { error: "réservé à l'administrateur" });
  const target = params[0];
  const { rows } = await query("SELECT id, login FROM users WHERE id = $1", [target]);
  if (!rows.length) return send(res, 404, { error: "compte introuvable" });

  let hash;
  try {
    hash = await hashPassword(String(body?.password || ""));
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  await query("UPDATE users SET password_hash = $2, password_set_at = now() WHERE id = $1", [target, hash]);
  const killed = await deleteUserSessions(target);
  log.info("auth", "mot de passe attribué par l'administrateur", { compte: loginCourt(rows[0].login), sessions_fermees: killed });
  journalCompte("mot de passe attribué par l'administrateur", rows[0], { detail: { sessions_fermees: killed } });
  send(res, 200, { ok: true, login: rows[0].login, sessionsFermees: killed });
}
