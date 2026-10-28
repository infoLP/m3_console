/* Connexion par le SSO Microsoft Entra — les deux rebonds du navigateur.
   M3-42, lot 1 de docs/plans/archives/PLAN-sso-entra.md.

   Fichier séparé de `auth.js`, qui garde le mot de passe local. L'étude prévoyait
   de tout mettre dans `auth.js` ; les tenir à part rend le lot 4 (retrait du mot
   de passe) mécanique — on supprimera un fichier et des lignes de routes, sans
   avoir à démêler deux authentifications entremêlées.

   Ces deux routes ne sont PAS sous /api : ce sont des navigations de navigateur,
   qui répondent par des redirections, pas du JSON. Elles sont donc appelées
   directement depuis src/server.js. */

import { send } from "../lib/http.js";
import { query } from "../lib/db.js";
import { createSession, cookieHeader } from "../lib/auth.js";
import { log, loginCourt } from "../lib/log.js";
import { journalCompte } from "../lib/journal.js";
import {
  entraConfig, entraEnabled, localEnabled, authMode,
  discover, pkcePair, randomToken, safeNextPath, buildAuthorizeUrl,
  exchangeCode, decodeJwtPayload, validateIdToken, identityFromClaims,
  saveAuthRequest, takeAuthRequest, pruneAuthRequests,
} from "../lib/oidc.js";

function redirect(res, to) {
  res.writeHead(302, { Location: to, "Cache-Control": "no-store" });
  res.end();
}

/* L'écran de connexion n'affiche qu'un libellé court, jamais le détail : un
   message d'erreur d'Entra cite volontiers le `redirect_uri` attendu, le nom de
   l'application ou l'identifiant du tenant. Le détail part dans logs/, où il sert
   au diagnostic sans être exposé. */
const refuse = (res, next, code) =>
  redirect(res, `/login?err=${encodeURIComponent(code)}&next=${encodeURIComponent(safeNextPath(next))}`);

/* Lu par la page de connexion pour savoir quoi afficher : le formulaire, le
   bouton, ou les deux. Ouverte sans session — c'est précisément la page qu'on
   voit avant d'en avoir une. */
export async function modes({ res }) {
  send(res, 200, { mode: authMode(), local: localEnabled(), entra: entraEnabled() });
}

/* --------------------------------------------------------- /auth/login */

export async function authStart(req, res, url) {
  const next = safeNextPath(url.searchParams.get("next"));

  if (!entraEnabled()) {
    log.warn("auth", "sso indisponible", { mode: authMode() });
    return refuse(res, next, "sso_indisponible");
  }

  const cfg = entraConfig();
  try {
    const doc = await discover(cfg);
    const { verifier, challenge } = pkcePair();
    const state = randomToken();
    const nonce = randomToken();

    /* Écrite AVANT la redirection : si l'insertion échoue, mieux vaut un refus
       immédiat qu'un retour d'Entra que nous serions incapables de reconnaître. */
    await saveAuthRequest({ state, nonce, codeVerifier: verifier, next });
    /* Au fil de l'eau plutôt que par une tâche planifiée : il n'y a pas
       d'ordonnanceur dans ce projet (cf. M3-58), et le balayage est indexé. */
    pruneAuthRequests().catch(() => {});

    const target = buildAuthorizeUrl({
      authorizationEndpoint: doc.authorization_endpoint,
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      state,
      nonce,
      codeChallenge: challenge,
      /* Le domaine du tenant évite le sélecteur de compte sur un poste joint. */
      domainHint: process.env.M3_ENTRA_DOMAIN_HINT || undefined,
    });
    log.info("auth", "sso départ", { next });
    return redirect(res, target);
  } catch (err) {
    log.error("auth", "sso départ impossible", { erreur: err.message });
    return refuse(res, next, "sso_indisponible");
  }
}

/* ------------------------------------------------------ /auth/callback */

export async function authCallback(req, res, url) {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  /* Entra refuse lui-même dans deux cas courants : la personne annule, ou elle
     n'est pas affectée à l'application (option « Affectation requise »). Ce
     refus-là n'est pas une panne, et ne doit pas s'afficher comme telle. */
  if (oauthError) {
    log.warn("auth", "sso refusé par Entra", {
      erreur: oauthError,
      detail: String(url.searchParams.get("error_description") || "").slice(0, 300),
    });
    return refuse(res, "/", oauthError === "access_denied" ? "sso_refuse" : "sso_echec");
  }

  if (!state || !code) return refuse(res, "/", "sso_echec");

  /* Consommée une seule fois. Un `state` inconnu, déjà utilisé ou expiré ne
     prouve rien : c'est aussi bien un rejeu qu'un onglet resté ouvert une heure.
     Le traitement est le même — on repart de la page de connexion. */
  const pending = await takeAuthRequest(state);
  if (!pending) {
    log.warn("auth", "sso state inconnu ou expiré", {});
    return refuse(res, "/", "sso_expire");
  }

  const cfg = entraConfig();
  if (!entraEnabled()) return refuse(res, pending.next, "sso_indisponible");

  let identity;
  try {
    const doc = await discover(cfg);
    const idToken = await exchangeCode({
      tokenEndpoint: doc.token_endpoint,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      code,
      redirectUri: cfg.redirectUri,
      codeVerifier: pending.codeVerifier,
    });
    const claims = decodeJwtPayload(idToken);
    validateIdToken(claims, { clientId: cfg.clientId, tenantId: cfg.tenantId, nonce: pending.nonce });
    identity = identityFromClaims(claims);
  } catch (err) {
    log.error("auth", "sso échec", { erreur: err.message, detail: err.detail || null });
    return refuse(res, pending.next, "sso_echec");
  }

  /* Rattachement : par `oid` si on le connaît déjà, sinon par UPN à la première
     connexion (§5.3). L'UPN ne sert qu'une fois ; ensuite c'est l'`oid` qui fait
     foi, et l'adresse peut changer librement. */
  let u = null;
  const byOid = await query(
    "SELECT id, name, login, role FROM users WHERE entra_oid = $1",
    [identity.oid]
  );
  u = byOid.rows[0] || null;

  if (!u && identity.upn) {
    const byLogin = await query(
      "SELECT id, name, login, role, entra_oid FROM users WHERE lower(login) = lower($1)",
      [identity.upn]
    );
    const candidate = byLogin.rows[0];
    /* Un compte déjà lié à une AUTRE identité Entra ne doit pas être repris :
       deux personnes se retrouveraient sur le même compte M3. L'index unique de
       la migration 008 le refuserait de toute façon — autant le dire ici, avec
       un message exploitable. */
    if (candidate && !candidate.entra_oid) {
      await query(
        "UPDATE users SET entra_oid = $2 WHERE id = $1",
        [candidate.id, identity.oid]
      );
      u = candidate;
      log.info("auth", "sso rattachement initial", { login: loginCourt(candidate.login) });
      journalCompte("sso rattachement initial", candidate, { user: candidate });
    } else if (candidate) {
      log.warn("auth", "sso compte déjà lié", { login: loginCourt(candidate.login) });
      return refuse(res, pending.next, "sso_conflit");
    }
  }

  /* AUCUNE CRÉATION AUTOMATIQUE DE COMPTE, délibérément. Entra authentifie tout
     l'annuaire ; M3 n'est ouvert qu'à une poignée de personnes, et le rôle
     (administrateur, super utilisateur, relecteur) est une décision humaine que
     rien dans le jeton ne porte tant que le lot 3 n'est pas fait. Provisionner à
     la volée donnerait un accès à quiconque possède un compte legalprime.
     Le compte se crée au back-office, avant la première connexion. */
  if (!u) {
    log.warn("auth", "sso sans compte M3", { login: loginCourt(identity.upn || identity.oid) });
    return refuse(res, pending.next, "sso_inconnu");
  }

  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [u.id]);
  const s = await createSession(u.id, req.headers["user-agent"]);
  res.setHeader("Set-Cookie", cookieHeader(s.id, s.maxAgeSeconds));
  log.info("auth", "connexion sso", { login: loginCourt(u.login), role: u.role });
  journalCompte("connexion sso", u, { user: u });
  return redirect(res, pending.next);
}
