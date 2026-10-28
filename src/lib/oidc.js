/* SSO Microsoft Entra ID — flux OpenID Connect « authorization code + PKCE ».
   M3-42, lot 1 de docs/plans/archives/PLAN-sso-entra.md.

   AUCUNE DÉPENDANCE, et c'est un choix documenté (§2 du plan). Le point qui fait
   d'ordinaire pencher vers une bibliothèque — vérifier la signature du JWT — ne
   s'applique pas ici : l'`id_token` n'arrive jamais par le navigateur, mais par
   le canal direct M3 → endpoint `/token`, en TLS, authentifié par le
   `client_secret`. OpenID Connect Core §3.1.3.7 dit explicitement que la
   validation TLS du serveur REMPLACE alors la vérification de signature. Restent
   cinq comparaisons (`aud`, `iss`/`tid`, `exp`/`nbf`, `nonce`), toutes ci-dessous
   et toutes testées.

   Ce module ne crée PAS de session : il dit seulement qui se présente. La session
   reste l'affaire de src/lib/auth.js, inchangé — c'est tout l'intérêt du
   découpage d'origine.

   Rien ici ne journalise le `client_secret` ni le `code` : ils ne doivent
   apparaître ni dans logs/, ni dans un message d'erreur rendu au navigateur. */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { query } from "./db.js";
/* Réutilisé plutôt que réécrit : ce transport porte la correction trouvée en
   revue le 2026-09-17 — `fetch` résout dès les EN-TÊTES, et désarmer le minuteur
   à ce moment-là laisse la lecture du corps sans borne. Un appel à Entra a
   exactement le même piège ; en recopier une version naïve ici reviendrait à
   réintroduire un défaut déjà corrigé ailleurs. */
import { fetchBounded } from "./http.js";

/* Entra est hors de notre contrôle : une connexion ne doit pas pouvoir pendre.
   Plus serré que les appels LLM (120 s) — personne n'attend deux minutes sur un
   écran de connexion, et il n'y a pas de file d'attente côté Microsoft. */
const TIMEOUT_MS = 15000;

/* Durée de vie d'une transaction OIDC : le temps de saisir un mot de passe et de
   valider un MFA, pas celui d'une pause. Au-delà, le retour est refusé et la
   personne recommence — ce qui est sans conséquence, la demande n'ayant encore
   rien créé. */
const REQUEST_TTL_SEC = 15 * 60;

export const SCOPES = "openid profile email";

/* ------------------------------------------------------------- configuration */

export function entraConfig() {
  return entraConfigFrom(process.env);
}

function entraConfigFrom(env) {
  const get = (k) => String(env[k] || "").trim();
  /* Fixée, jamais reconstruite à partir de la requête (§5.6 du plan) : derrière
     Traefik, le serveur se voit en `http://…:4173`, alors qu'Entra attend le
     `redirect_uri` enregistré AU CARACTÈRE PRÈS. Le déduire des en-têtes, c'est
     faire dépendre la connexion d'une configuration de proxy. */
  const publicUrl = get("M3_PUBLIC_URL").replace(/\/+$/, "");
  return {
    tenantId: get("M3_ENTRA_TENANT_ID"),
    clientId: get("M3_ENTRA_CLIENT_ID"),
    clientSecret: get("M3_ENTRA_CLIENT_SECRET"),
    publicUrl,
    redirectUri: publicUrl ? `${publicUrl}/auth/callback` : "",
  };
}

export function entraConfigured(cfg = entraConfig()) {
  return Boolean(cfg.tenantId && cfg.clientId && cfg.clientSecret && cfg.publicUrl);
}

export const AUTH_MODES = ["entra", "local", "both"];

/* M3-98 — booléen de la stack Portainer, « comme dans M2 » : autorise ou non la
   connexion par mot de passe à côté d'Entra. Ce n'est PAS un second mécanisme :
   c'est un raccourci TRADUIT en mode (vrai → `both`, faux → `entra`), qui passe
   donc par le même verrou `localEnabled()` — faux ne ferme le mot de passe que si
   Entra est réellement configuré.

   Même nom que dans M2_Console (src/config.ts de M2), pour qu'une stack se règle
   pareil des deux côtés. Différence voulue : absente, M2 ferme le mot de passe ;
   ici le mode se déduit comme avant (authMode). test/oidc.test.js vérifie que
   docker-compose.yml, .env.docker.example et src/config.ts suivent ce nom. */
export const PASSWORD_LOGIN_ENV = "CONSOLE_CONNEXION_LOCALE";
export const OLD_PASSWORD_LOGIN_ENV = "M3_PASSWORD_LOGIN";

const VRAI = ["true", "1", "oui", "yes", "on"];
const FAUX = ["false", "0", "non", "no", "off"];

/* true / false, null si la variable est vide, undefined si elle est illisible
   (ignorée, et signalée au démarrage). */
export function passwordLoginFlag(env = process.env) {
  const raw = String(env[PASSWORD_LOGIN_ENV] ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (VRAI.includes(raw)) return true;
  if (FAUX.includes(raw)) return false;
  return undefined;
}

export function modeFromPasswordFlag(flag) {
  if (flag === true) return "both";
  if (flag === false) return "entra";
  return null;
}

/* Défaut volontairement conservateur : tant qu'Entra n'est pas configuré, le site
   se comporte exactement comme avant. Le jour où les trois valeurs arrivent, le
   défaut passe à `both` sans qu'il faille y penser — les deux moyens cohabitent,
   ce qui est l'état voulu pendant toute la transition. */
export function authMode() {
  const raw = String(process.env.M3_AUTH_MODE || "").trim().toLowerCase();
  /* M3_AUTH_MODE, plus précis, l'emporte sur le booléen ; un désaccord entre les
     deux est signalé au démarrage (authModeWarnings). */
  if (AUTH_MODES.includes(raw)) return raw;
  const viaBooleen = modeFromPasswordFlag(passwordLoginFlag());
  if (viaBooleen) return viaBooleen;
  return entraConfigured() ? "both" : "local";
}

/* Ce qui mérite d'être dit au démarrage (src/instrumentation.ts) : une valeur
   illisible, un conflit entre les deux variables, ou un retrait du mot de passe
   que le verrou empêche. Rien n'est bloquant : la règle de authMode() s'applique. */
export function authModeWarnings(env = process.env) {
  const out = [];
  const raw = String(env.M3_AUTH_MODE || "").trim().toLowerCase();
  const brut = String(env[PASSWORD_LOGIN_ENV] ?? "").trim();
  const flag = passwordLoginFlag(env);
  if (raw && !AUTH_MODES.includes(raw)) out.push(`M3_AUTH_MODE=${raw} : valeur inconnue, ignorée (attendu : ${AUTH_MODES.join(", ")})`);
  if (flag === undefined) out.push(`${PASSWORD_LOGIN_ENV}=${brut} : valeur illisible, ignorée (attendu : true ou false)`);
  /* L'ancien nom provisoire n'est pas relu en repli : un seul nom, mais une stack
     qui le pose encore doit l'apprendre au démarrage. */
  if (String(env[OLD_PASSWORD_LOGIN_ENV] ?? "").trim()) {
    out.push(`${OLD_PASSWORD_LOGIN_ENV} : renommée en ${PASSWORD_LOGIN_ENV}, ignorée`);
  }
  const viaBooleen = modeFromPasswordFlag(flag);
  if (AUTH_MODES.includes(raw) && viaBooleen && raw !== viaBooleen) {
    out.push(`conflit : M3_AUTH_MODE=${raw} et ${PASSWORD_LOGIN_ENV}=${brut} (soit ${viaBooleen}) se contredisent — M3_AUTH_MODE l'emporte, retirer l'une des deux`);
  }
  const mode = AUTH_MODES.includes(raw) ? raw : viaBooleen;
  if (mode === "entra" && !entraConfigured(entraConfigFrom(env))) {
    out.push("la connexion par mot de passe devait être retirée, mais Entra n'est pas configuré : elle reste ouverte (verrou localEnabled)");
  }
  return out;
}

export function entraEnabled() {
  return authMode() !== "local" && entraConfigured();
}

/* LE VERROU DE SÉCURITÉ (§5.4 du plan). `M3_AUTH_MODE=entra` retire le mot de
   passe — mais SEULEMENT si Entra est réellement configuré. Une variable mal
   orthographiée, un secret retiré de la stack, et le mode `entra` fermerait le
   site à tout le monde, administrateur compris, sans aucun moyen d'entrer pour
   le réparer. Ici, la porte locale se rouvre d'elle-même dans ce cas. */
export function localEnabled() {
  return authMode() !== "entra" || !entraConfigured();
}

/* -------------------------------------------------------------- découverte */

let cachedDoc = null;

/* Les endpoints sont publiés par le tenant. Les écrire en dur marcherait
   aujourd'hui, mais Microsoft fait évoluer ces URL ; la découverte est le
   contrat prévu pour ça. Mise en cache : une connexion ne doit pas coûter deux
   allers-retours. */
export async function discover(cfg = entraConfig(), { force = false } = {}) {
  if (!force && cachedDoc && cachedDoc.tenantId === cfg.tenantId) return cachedDoc.doc;
  if (!cfg.tenantId) throw new Error("SSO : M3_ENTRA_TENANT_ID absent");

  const url = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/v2.0/.well-known/openid-configuration`;
  const res = await fetchBounded(url, { method: "GET" }, TIMEOUT_MS, "découverte Entra");
  if (!res.ok) throw new Error(`découverte Entra : réponse ${res.status}`);

  const doc = res.json();
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.issuer) {
    throw new Error("découverte Entra : document incomplet");
  }
  cachedDoc = { tenantId: cfg.tenantId, doc };
  return doc;
}

export function resetDiscoveryCache() {
  cachedDoc = null;
}

/* -------------------------------------------------------- PKCE et aléas */

/* PKCE : le `code_verifier` ne quitte jamais le serveur, seule son empreinte
   SHA-256 part dans l'URL d'autorisation. Un code d'autorisation intercepté est
   alors inéchangeable — c'est la protection qui rend l'aller-retour sûr même si
   l'URL de retour fuite (historique de navigateur, journal de proxy). */
export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export const randomToken = () => randomBytes(32).toString("base64url");

/* Jamais une URL absolue : sans ce filtre, `?next=https://ailleurs` ferait de la
   page de connexion un tremplin vers un site tiers, avec notre nom de domaine en
   point de départ. `//ailleurs` et `/\ailleurs` sont des URL absolues pour le
   navigateur — d'où le refus du second caractère `/` ou `\`. */
export function safeNextPath(raw) {
  const s = String(raw || "");
  if (s === "/") return "/";
  return /^\/[^/\\]/.test(s) ? s : "/";
}

/* ------------------------------------------------- URL d'autorisation */

export function buildAuthorizeUrl({ authorizationEndpoint, clientId, redirectUri, state, nonce, codeChallenge, loginHint, domainHint }) {
  const u = new URL(authorizationEndpoint);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  /* `query` et non `fragment` : le code doit arriver au SERVEUR. Un fragment
     reste côté navigateur et n'est jamais transmis. */
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  /* Confort, pas sécurité (§5.7) : sur un poste joint au domaine, ces deux
     indices suppriment le sélecteur de compte et la saisie — la personne ne voit
     aucun écran Microsoft. */
  if (domainHint) u.searchParams.set("domain_hint", domainHint);
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

/* ------------------------------------------------------- échange du code */

export async function exchangeCode({ tokenEndpoint, clientId, clientSecret, code, redirectUri, codeVerifier }) {
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    scope: SCOPES,
  });

  const res = await fetchBounded(
    tokenEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    TIMEOUT_MS,
    "échange du code Entra"
  );

  if (!res.ok) {
    /* Le corps d'erreur d'Entra est utile au diagnostic (`invalid_client`,
       `redirect_uri_mismatch`…) mais ne doit pas remonter tel quel au navigateur :
       l'appelant journalise, et rend un message générique. */
    let detail = "";
    try {
      const body = res.json();
      detail = body.error_description || body.error || "";
    } catch { detail = res.text.slice(0, 200); }
    const err = new Error(`échange du code Entra : réponse ${res.status}`);
    err.detail = String(detail).slice(0, 400);
    throw err;
  }

  const body = res.json();
  if (!body.id_token) throw new Error("échange du code Entra : id_token absent de la réponse");
  return body.id_token;
}

/* ------------------------------------------------------ lecture du jeton */

export function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("jeton d'identité malformé");
  let json;
  try {
    json = Buffer.from(parts[1], "base64url").toString("utf8");
  } catch {
    throw new Error("jeton d'identité illisible");
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("jeton d'identité illisible");
  }
}

/* Comparaison à temps constant pour le `nonce` : c'est le seul champ qu'un
   attaquant chercherait à deviner caractère par caractère. Les autres sont des
   valeurs publiques, une comparaison ordinaire suffit. */
function sameSecret(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

/* Les cinq contrôles annoncés. Chacun répond à une question précise :
     aud   — ce jeton a-t-il été émis POUR NOUS, ou pour une autre application ?
     tid   — vient-il de NOTRE annuaire, ou d'un tenant quelconque ?
     iss   — l'émetteur annoncé correspond-il à ce tenant ?
     exp   — est-il encore valide ?
     nonce — répond-il à LA demande que nous venons d'émettre, ou est-il rejoué ?
   Sans le dernier, un jeton valide capté ailleurs ouvrirait une session ici. */
export function validateIdToken(claims, { clientId, tenantId, nonce, now = Date.now(), skewSec = 120 }) {
  const t = Math.floor(now / 1000);

  if (claims.aud !== clientId) throw new Error("jeton d'identité : destinataire inattendu");
  if (claims.tid !== tenantId) throw new Error("jeton d'identité : annuaire inattendu");

  const expectedIssuers = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
  ];
  if (!expectedIssuers.includes(String(claims.iss || ""))) {
    throw new Error("jeton d'identité : émetteur inattendu");
  }

  if (typeof claims.exp !== "number" || claims.exp + skewSec < t) {
    throw new Error("jeton d'identité expiré");
  }
  if (typeof claims.nbf === "number" && claims.nbf - skewSec > t) {
    throw new Error("jeton d'identité pas encore valide");
  }
  if (!sameSecret(claims.nonce, nonce)) {
    throw new Error("jeton d'identité : nonce inattendu");
  }
  return true;
}

/* `oid` est obligatoire : c'est la seule valeur immutable, et donc la seule sur
   laquelle on accepte de rattacher un compte durablement (§5.3). L'UPN sert au
   premier rattachement, puis devient un simple libellé qui peut changer. */
export function identityFromClaims(claims) {
  const oid = String(claims.oid || "").trim();
  if (!oid) throw new Error("jeton d'identité : oid absent");
  const upn = String(claims.upn || claims.preferred_username || claims.email || "").trim();
  return {
    oid,
    upn,
    name: String(claims.name || upn || "").trim(),
  };
}

/* ------------------------------------------ transactions en cours (base) */

export async function saveAuthRequest({ state, nonce, codeVerifier, next }) {
  await query(
    `INSERT INTO auth_requests (state, nonce, code_verifier, next, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
    [state, nonce, codeVerifier, safeNextPath(next), String(REQUEST_TTL_SEC)]
  );
}

/* Lecture ET suppression en une seule instruction : une demande ne sert qu'une
   fois. Deux retours avec le même `state` — rejeu, ou double-clic sur le bouton
   « précédent » — et seul le premier trouve quelque chose. */
export async function takeAuthRequest(state) {
  if (!state) return null;
  const { rows } = await query(
    `DELETE FROM auth_requests
      WHERE state = $1 AND expires_at > now()
      RETURNING state, nonce, code_verifier, next`,
    [state]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { state: r.state, nonce: r.nonce, codeVerifier: r.code_verifier, next: safeNextPath(r.next) };
}

/* Les demandes abandonnées — onglet fermé devant l'écran Microsoft — ne sont
   jamais consommées. Sans ce balayage, la table grossit indéfiniment. */
export async function pruneAuthRequests() {
  const { rowCount } = await query("DELETE FROM auth_requests WHERE expires_at <= now()");
  return rowCount;
}
