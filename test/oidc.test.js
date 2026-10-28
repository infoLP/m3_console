/* SSO Microsoft Entra — M3-42, lot 1.

   Tout est exercé SANS app registration, sans secret et sans base : les
   fonctions du flux sont pures, et les deux seuls appels réseau (découverte et
   échange du code) sont joués avec un `fetch` de substitution. C'est ce qui
   permet d'écrire ce lot avant que la DSI ait répondu, et de le garder ensuite —
   un contrôle qu'on retirerait du jeton ferait tomber un test, pas seulement une
   session.

   Les cas les plus importants ne sont pas les chemins qui marchent, mais les
   refus : un jeton émis pour une autre application, un nonce rejoué, un `next`
   qui pointe hors du site, et le verrou qui empêche de se fermer dehors. */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  authMode, entraConfig, entraConfigured, entraEnabled, localEnabled,
  pkcePair, safeNextPath, buildAuthorizeUrl, discover, resetDiscoveryCache,
  exchangeCode, decodeJwtPayload, validateIdToken, identityFromClaims, SCOPES,
  PASSWORD_LOGIN_ENV, OLD_PASSWORD_LOGIN_ENV, passwordLoginFlag, modeFromPasswordFlag, authModeWarnings,
} from "../src/lib/oidc.js";

/* --- outillage -------------------------------------------------------------- */

const ENV_KEYS = [
  "M3_ENTRA_TENANT_ID", "M3_ENTRA_CLIENT_ID", "M3_ENTRA_CLIENT_SECRET",
  "M3_PUBLIC_URL", "M3_AUTH_MODE", "M3_ENTRA_DOMAIN_HINT", PASSWORD_LOGIN_ENV, OLD_PASSWORD_LOGIN_ENV,
];

/* Les modes se lisent dans l'environnement : chaque cas part d'une table rase,
   sans quoi l'ordre des tests déciderait du résultat.

   Le `finally` d'un try/finally classique ne convient PAS ici : il s'exécute dès
   que `fn()` RETOURNE, et une fonction asynchrone retourne sa promesse tout de
   suite. L'environnement était donc remis à zéro avant que le corps du test ait
   commencé à travailler, et `discover()` ne voyait plus aucune configuration.
   D'où la restauration chaînée sur la promesse quand il y en a une. */
function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);

  const restore = () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetDiscoveryCache();
  };

  let out;
  try {
    out = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (out && typeof out.then === "function") {
    return out.then(
      (v) => { restore(); return v; },
      (e) => { restore(); throw e; }
    );
  }
  restore();
  return out;
}

const CONFIG_COMPLETE = {
  M3_ENTRA_TENANT_ID: "tenant-abc",
  M3_ENTRA_CLIENT_ID: "client-xyz",
  M3_ENTRA_CLIENT_SECRET: "secret-123",
  M3_PUBLIC_URL: "https://m3-prototype.dev.legalprime.fr",
};

function stubFetch(plan) {
  const calls = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ?? null });
    const step = plan[Math.min(i, plan.length - 1)];
    i++;
    return typeof step === "function" ? step(init) : step;
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const reply = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
});

const b64url = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
const jwt = (claims) => `${b64url({ alg: "RS256" })}.${b64url(claims)}.signature-non-verifiee`;

const claimsOk = (over = {}) => ({
  aud: "client-xyz",
  tid: "tenant-abc",
  iss: "https://login.microsoftonline.com/tenant-abc/v2.0",
  exp: Math.floor(Date.now() / 1000) + 600,
  nbf: Math.floor(Date.now() / 1000) - 10,
  nonce: "nonce-attendu",
  oid: "oid-0001",
  upn: "prenom.nom@legalprime.fr",
  name: "Prénom Nom",
  ...over,
});

const VALID_OPTS = { clientId: "client-xyz", tenantId: "tenant-abc", nonce: "nonce-attendu" };

/* --- modes de connexion ----------------------------------------------------- */

test("sans configuration Entra, le site reste en mode local", () => {
  withEnv({}, () => {
    assert.equal(entraConfigured(), false);
    assert.equal(authMode(), "local");
    assert.equal(entraEnabled(), false);
    assert.equal(localEnabled(), true);
  });
});

test("une configuration incomplète ne suffit pas : les quatre valeurs sont exigées", () => {
  for (const manquante of Object.keys(CONFIG_COMPLETE)) {
    const partiel = { ...CONFIG_COMPLETE };
    delete partiel[manquante];
    withEnv(partiel, () => {
      assert.equal(entraConfigured(), false, `${manquante} manquante devrait suffire à désactiver`);
      assert.equal(entraEnabled(), false);
      assert.equal(localEnabled(), true);
    });
  }
});

test("dès qu'Entra est configuré, les deux moyens cohabitent sans régler M3_AUTH_MODE", () => {
  withEnv(CONFIG_COMPLETE, () => {
    assert.equal(authMode(), "both");
    assert.equal(entraEnabled(), true);
    assert.equal(localEnabled(), true);
  });
});

/* C'est le test qui compte le plus de ce fichier. Sans ce repli, une variable
   mal orthographiée dans la stack Portainer — ou un secret retiré — fermerait le
   site à tout le monde, administrateur compris, sans aucun moyen d'entrer pour
   le réparer. */
test("M3_AUTH_MODE=entra mal configuré ne verrouille PAS le site", () => {
  withEnv({ M3_AUTH_MODE: "entra" }, () => {
    assert.equal(entraEnabled(), false, "Entra n'est pas configuré : il ne peut pas être actif");
    assert.equal(localEnabled(), true, "la porte locale doit rester ouverte");
  });
  withEnv({ ...CONFIG_COMPLETE, M3_ENTRA_CLIENT_SECRET: "", M3_AUTH_MODE: "entra" }, () => {
    assert.equal(localEnabled(), true, "secret retiré : la porte locale se rouvre");
  });
});

test("M3_AUTH_MODE=entra correctement configuré retire bien le mot de passe", () => {
  withEnv({ ...CONFIG_COMPLETE, M3_AUTH_MODE: "entra" }, () => {
    assert.equal(entraEnabled(), true);
    assert.equal(localEnabled(), false);
  });
});

test("une valeur inconnue de M3_AUTH_MODE est ignorée, pas interprétée", () => {
  withEnv({ ...CONFIG_COMPLETE, M3_AUTH_MODE: "ENTRA_OU_PAS" }, () => {
    assert.equal(authMode(), "both");
  });
});

/* --- booléen de connexion par mot de passe (M3-98) -------------------------- */

const B = PASSWORD_LOGIN_ENV;

test("M3-98 : le booléen se lit vrai / faux, vide = absent, autre chose = illisible", () => {
  for (const v of ["true", "TRUE", "1", "oui", " yes ", "on"]) assert.equal(passwordLoginFlag({ [B]: v }), true, v);
  for (const v of ["false", "False", "0", "non", "no", "off"]) assert.equal(passwordLoginFlag({ [B]: v }), false, v);
  assert.equal(passwordLoginFlag({}), null);
  assert.equal(passwordLoginFlag({ [B]: "  " }), null);
  assert.equal(passwordLoginFlag({ [B]: "peut-être" }), undefined);
  assert.equal(modeFromPasswordFlag(true), "both");
  assert.equal(modeFromPasswordFlag(false), "entra");
  assert.equal(modeFromPasswordFlag(undefined), null);
});

test("M3-98 : vrai → both, faux → entra, quand M3_AUTH_MODE est vide", () => {
  withEnv({ ...CONFIG_COMPLETE, [B]: "true" }, () => {
    assert.equal(authMode(), "both");
    assert.equal(localEnabled(), true);
    assert.equal(entraEnabled(), true);
  });
  withEnv({ ...CONFIG_COMPLETE, [B]: "false" }, () => {
    assert.equal(authMode(), "entra");
    assert.equal(localEnabled(), false, "Entra configuré : le mot de passe est bien retiré");
    assert.equal(entraEnabled(), true);
    assert.deepEqual(authModeWarnings(process.env), []);
  });
});

/* Le même verrou que M3_AUTH_MODE=entra : le booléen n'est qu'une autre façon de
   l'écrire, il ne doit pas devenir une porte dérobée pour fermer le site. */
test("M3-98 : faux SANS Entra configuré ne verrouille PAS le site, et le dit", () => {
  withEnv({ [B]: "false" }, () => {
    assert.equal(authMode(), "entra");
    assert.equal(localEnabled(), true, "la porte locale reste ouverte");
    assert.equal(entraEnabled(), false);
    assert.ok(authModeWarnings(process.env).some((m) => /reste ouverte/.test(m)));
  });
  withEnv({ ...CONFIG_COMPLETE, M3_ENTRA_CLIENT_SECRET: "", [B]: "0" }, () => {
    assert.equal(localEnabled(), true, "secret retiré : la porte locale se rouvre");
  });
});

test("M3-98 : vrai sans Entra configuré = mot de passe seul, comme avant", () => {
  withEnv({ [B]: "true" }, () => {
    assert.equal(localEnabled(), true);
    assert.equal(entraEnabled(), false);
  });
});

test("M3-98 : M3_AUTH_MODE l'emporte, et le conflit est signalé", () => {
  withEnv({ ...CONFIG_COMPLETE, M3_AUTH_MODE: "both", [B]: "false" }, () => {
    assert.equal(authMode(), "both");
    assert.equal(localEnabled(), true);
    const w = authModeWarnings(process.env);
    assert.equal(w.length, 1);
    assert.match(w[0], /conflit/);
    assert.match(w[0], new RegExp(B));
  });
  withEnv({ ...CONFIG_COMPLETE, M3_AUTH_MODE: "local", [B]: "true" }, () => {
    assert.equal(authMode(), "local");
    assert.match(authModeWarnings(process.env).join(" "), /conflit/);
  });
  /* Les deux disent la même chose : rien à signaler. */
  withEnv({ ...CONFIG_COMPLETE, M3_AUTH_MODE: "entra", [B]: "false" }, () => {
    assert.deepEqual(authModeWarnings(process.env), []);
  });
});

test("M3-98 : un booléen illisible est ignoré (mode déduit) et signalé", () => {
  withEnv({ ...CONFIG_COMPLETE, [B]: "peut-être" }, () => {
    assert.equal(authMode(), "both");
    assert.match(authModeWarnings(process.env).join(" "), /illisible/);
  });
  withEnv({ M3_AUTH_MODE: "ENTRA_OU_PAS" }, () => {
    assert.match(authModeWarnings(process.env).join(" "), /valeur inconnue/);
  });
});

test("M3-98 : l'ancien nom M3_PASSWORD_LOGIN est signalé, jamais relu en repli", () => {
  withEnv({ ...CONFIG_COMPLETE, [OLD_PASSWORD_LOGIN_ENV]: "false" }, () => {
    assert.equal(authMode(), "both", "faux sous l'ancien nom ne retire pas le mot de passe");
    assert.ok(authModeWarnings(process.env).some((m) => m === `${OLD_PASSWORD_LOGIN_ENV} : renommée en ${B}, ignorée`));
  });
  withEnv({ ...CONFIG_COMPLETE }, () => {
    assert.ok(!authModeWarnings(process.env).some((m) => /renommée/.test(m)), "rien à dire sans l'ancien nom");
  });
});

test("M3-98 : le nom de M2_Console est le même partout où la stack le pose", () => {
  /* CONSOLE_CONNEXION_LOCALE, comme dans M2 : si le nom change dans oidc.js, ce
     test rappelle les trois autres endroits. */
  assert.equal(B, "CONSOLE_CONNEXION_LOCALE");
  const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  /* m3_console (extraire-console.mjs) : la stack est au moteur ; ici, .env.example. */
  assert.match(lire(".env.example"), new RegExp("^" + B + "=", "m"));
  assert.match(lire("src/config.ts"), new RegExp("^\\s+" + B + ":", "m"));
});

test("le redirect_uri se déduit de M3_PUBLIC_URL, barre finale comprise", () => {
  withEnv({ ...CONFIG_COMPLETE, M3_PUBLIC_URL: "https://exemple.fr/" }, () => {
    assert.equal(entraConfig().redirectUri, "https://exemple.fr/auth/callback");
  });
});

/* --- retour après connexion ------------------------------------------------- */

test("le chemin de retour ne peut pas quitter le site", () => {
  assert.equal(safeNextPath("/console"), "/console");
  assert.equal(safeNextPath("/admin?onglet=llm"), "/admin?onglet=llm");
  assert.equal(safeNextPath("/"), "/");
  /* Les trois formes qu'un navigateur traite comme des URL absolues. */
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("/\\evil.example"), "/");
  assert.equal(safeNextPath("https://evil.example"), "/");
  assert.equal(safeNextPath(""), "/");
  assert.equal(safeNextPath(null), "/");
  assert.equal(safeNextPath(undefined), "/");
});

/* --- PKCE ------------------------------------------------------------------- */

test("le code_challenge est bien le SHA-256 du verifier, en base64url", () => {
  const { verifier, challenge } = pkcePair();
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  /* base64url : ni +, ni /, ni = — sans quoi l'URL d'autorisation serait à
     ré-encoder, et Entra refuserait le challenge. */
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.ok(verifier.length >= 43, "RFC 7636 : 43 caractères minimum");
});

test("deux demandes ne partagent jamais leur verifier", () => {
  const a = pkcePair(), b = pkcePair();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.challenge, b.challenge);
});

/* --- URL d'autorisation ----------------------------------------------------- */

test("l'URL d'autorisation porte tout ce qu'Entra exige", () => {
  const url = new URL(buildAuthorizeUrl({
    authorizationEndpoint: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/authorize",
    clientId: "client-xyz",
    redirectUri: "https://m3-prototype.dev.legalprime.fr/auth/callback",
    state: "etat-1", nonce: "nonce-1", codeChallenge: "challenge-1",
  }));
  const p = url.searchParams;
  assert.equal(p.get("client_id"), "client-xyz");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("redirect_uri"), "https://m3-prototype.dev.legalprime.fr/auth/callback");
  assert.equal(p.get("state"), "etat-1");
  assert.equal(p.get("nonce"), "nonce-1");
  assert.equal(p.get("code_challenge"), "challenge-1");
  assert.equal(p.get("code_challenge_method"), "S256", "S256 et jamais 'plain'");
  assert.equal(p.get("scope"), SCOPES);
  /* Le code doit arriver au SERVEUR : un fragment resterait dans le navigateur. */
  assert.equal(p.get("response_mode"), "query");
  /* Pas de refresh token : on ne rappelle jamais Microsoft après la connexion. */
  assert.ok(!SCOPES.includes("offline_access"));
});

test("les indices de compte ne sont posés que s'ils existent", () => {
  const sans = new URL(buildAuthorizeUrl({
    authorizationEndpoint: "https://exemple/authorize", clientId: "c",
    redirectUri: "https://m3/auth/callback", state: "s", nonce: "n", codeChallenge: "ch",
  }));
  assert.equal(sans.searchParams.has("domain_hint"), false);
  assert.equal(sans.searchParams.has("login_hint"), false);

  const avec = new URL(buildAuthorizeUrl({
    authorizationEndpoint: "https://exemple/authorize", clientId: "c",
    redirectUri: "https://m3/auth/callback", state: "s", nonce: "n", codeChallenge: "ch",
    domainHint: "legalprime.fr", loginHint: "prenom.nom@legalprime.fr",
  }));
  assert.equal(avec.searchParams.get("domain_hint"), "legalprime.fr");
  assert.equal(avec.searchParams.get("login_hint"), "prenom.nom@legalprime.fr");
});

/* --- découverte ------------------------------------------------------------- */

test("la découverte lit les endpoints du tenant et les met en cache", async () => {
  const doc = {
    issuer: "https://login.microsoftonline.com/tenant-abc/v2.0",
    authorization_endpoint: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/authorize",
    token_endpoint: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token",
  };
  const f = stubFetch([reply(200, doc)]);
  try {
    await withEnv(CONFIG_COMPLETE, async () => {
      const a = await discover();
      const b = await discover();
      assert.equal(a.token_endpoint, doc.token_endpoint);
      assert.equal(b.token_endpoint, doc.token_endpoint);
      assert.equal(f.calls.length, 1, "le second appel doit venir du cache");
      assert.match(f.calls[0].url, /\/tenant-abc\/v2\.0\/\.well-known\/openid-configuration$/);
    });
  } finally { f.restore(); }
});

test("un document de découverte incomplet est refusé, pas utilisé à moitié", async () => {
  const f = stubFetch([reply(200, { issuer: "https://login.microsoftonline.com/tenant-abc/v2.0" })]);
  try {
    await withEnv(CONFIG_COMPLETE, async () => {
      await assert.rejects(() => discover(), /document incomplet/);
    });
  } finally { f.restore(); }
});

/* --- échange du code -------------------------------------------------------- */

test("l'échange envoie le verifier et le secret, en formulaire", async () => {
  const f = stubFetch([reply(200, { id_token: jwt(claimsOk()) })]);
  try {
    const token = await exchangeCode({
      tokenEndpoint: "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token",
      clientId: "client-xyz", clientSecret: "secret-123",
      code: "code-recu", redirectUri: "https://m3/auth/callback", codeVerifier: "verifier-1",
    });
    assert.ok(token.startsWith("ey") || token.includes("."));

    const envoi = new URLSearchParams(f.calls[0].body);
    assert.equal(envoi.get("grant_type"), "authorization_code");
    assert.equal(envoi.get("code"), "code-recu");
    assert.equal(envoi.get("code_verifier"), "verifier-1");
    assert.equal(envoi.get("client_secret"), "secret-123");
    assert.equal(envoi.get("redirect_uri"), "https://m3/auth/callback");
    assert.equal(f.calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
    /* En POST : un code d'autorisation dans une URL finirait dans les journaux
       de tous les proxys traversés. */
    assert.equal(f.calls[0].init.method, "POST");
  } finally { f.restore(); }
});

test("une erreur d'Entra est remontée avec son détail, hors du message public", async () => {
  const f = stubFetch([reply(400, {
    error: "invalid_client",
    error_description: "AADSTS7000215: Invalid client secret provided.",
  })]);
  try {
    await assert.rejects(
      () => exchangeCode({
        tokenEndpoint: "https://exemple/token", clientId: "c", clientSecret: "mauvais",
        code: "x", redirectUri: "https://m3/auth/callback", codeVerifier: "v",
      }),
      (err) => {
        /* Le message, lui, pourra s'afficher : il ne cite ni le secret ni l'URL. */
        assert.match(err.message, /réponse 400/);
        assert.match(err.detail, /AADSTS7000215/);
        return true;
      }
    );
  } finally { f.restore(); }
});

test("une réponse sans id_token est un échec, pas une connexion muette", async () => {
  const f = stubFetch([reply(200, { access_token: "jeton-graph" })]);
  try {
    await assert.rejects(
      () => exchangeCode({
        tokenEndpoint: "https://exemple/token", clientId: "c", clientSecret: "s",
        code: "x", redirectUri: "https://m3/auth/callback", codeVerifier: "v",
      }),
      /id_token absent/
    );
  } finally { f.restore(); }
});

/* --- lecture et validation du jeton ----------------------------------------- */

test("un jeton malformé ne passe pas pour un jeton vide", () => {
  assert.throws(() => decodeJwtPayload("pas-un-jwt"), /malformé/);
  assert.throws(() => decodeJwtPayload(""), /malformé/);
  assert.throws(() => decodeJwtPayload(null), /malformé/);
  assert.throws(() => decodeJwtPayload("a.b.c.d"), /malformé/);
  assert.throws(() => decodeJwtPayload(`${b64url({})}.pas-du-json.sig`), /illisible/);
});

test("un jeton conforme est accepté", () => {
  assert.equal(validateIdToken(claimsOk(), VALID_OPTS), true);
});

test("les cinq refus : destinataire, annuaire, émetteur, expiration, nonce", () => {
  const cas = [
    ["destinataire", { aud: "une-autre-application" }, /destinataire inattendu/],
    ["annuaire", { tid: "un-autre-tenant" }, /annuaire inattendu/],
    ["émetteur", { iss: "https://login.microsoftonline.com/autre/v2.0" }, /émetteur inattendu/],
    ["expiration", { exp: Math.floor(Date.now() / 1000) - 3600 }, /expiré/],
    ["nonce", { nonce: "nonce-d-une-autre-demande" }, /nonce inattendu/],
  ];
  for (const [nom, over, attendu] of cas) {
    assert.throws(() => validateIdToken(claimsOk(over), VALID_OPTS), attendu, `cas ${nom}`);
  }
});

/* Sans ce contrôle, un jeton parfaitement valide capté sur une autre session
   ouvrirait une session ici : c'est précisément ce que le nonce empêche. */
test("un nonce absent ne vaut pas un nonce correct", () => {
  assert.throws(() => validateIdToken(claimsOk({ nonce: undefined }), VALID_OPTS), /nonce inattendu/);
  assert.throws(() => validateIdToken(claimsOk({ nonce: "" }), VALID_OPTS), /nonce inattendu/);
  /* Et une demande sans nonce attendu ne doit pas tout accepter. */
  assert.throws(
    () => validateIdToken(claimsOk({ nonce: "" }), { ...VALID_OPTS, nonce: "" }),
    /nonce inattendu/
  );
});

test("un jeton pas encore valide est refusé", () => {
  assert.throws(
    () => validateIdToken(claimsOk({ nbf: Math.floor(Date.now() / 1000) + 3600 }), VALID_OPTS),
    /pas encore valide/
  );
});

/* Les horloges du serveur et du tenant ne sont jamais exactement d'accord : sans
   tolérance, une poignée de connexions échouerait sans raison visible. */
test("une dérive d'horloge d'une minute reste tolérée", () => {
  const presqueExpire = claimsOk({ exp: Math.floor(Date.now() / 1000) - 60 });
  assert.equal(validateIdToken(presqueExpire, VALID_OPTS), true);
  const toutJuste = claimsOk({ nbf: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(validateIdToken(toutJuste, VALID_OPTS), true);
});

test("l'émetteur v1 du tenant est accepté, celui d'un autre tenant non", () => {
  assert.equal(
    validateIdToken(claimsOk({ iss: "https://sts.windows.net/tenant-abc/" }), VALID_OPTS),
    true
  );
  assert.throws(
    () => validateIdToken(claimsOk({ iss: "https://sts.windows.net/autre-tenant/" }), VALID_OPTS),
    /émetteur inattendu/
  );
});

test("un exp non numérique ne passe pas pour une date valable", () => {
  assert.throws(() => validateIdToken(claimsOk({ exp: "plus tard" }), VALID_OPTS), /expiré/);
  assert.throws(() => validateIdToken(claimsOk({ exp: undefined }), VALID_OPTS), /expiré/);
});

/* --- identité --------------------------------------------------------------- */

test("l'oid est obligatoire : c'est la seule valeur immutable", () => {
  assert.throws(() => identityFromClaims(claimsOk({ oid: undefined })), /oid absent/);
  assert.throws(() => identityFromClaims(claimsOk({ oid: "  " })), /oid absent/);
});

test("l'UPN est préféré à preferred_username, qui est modifiable", () => {
  const id = identityFromClaims(claimsOk({
    upn: "prenom.nom@legalprime.fr",
    preferred_username: "ancien.nom@legalprime.fr",
  }));
  assert.equal(id.upn, "prenom.nom@legalprime.fr");
  assert.equal(id.oid, "oid-0001");
  assert.equal(id.name, "Prénom Nom");
});

test("sans upn, on se rabat sur preferred_username puis sur email", () => {
  /* Aucun des trois champs : l'UPN ressort vide, et c'est voulu. Le rattachement
     se fera alors par `oid` seul — ou échouera proprement en « compte inconnu »,
     jamais sur une adresse inventée. */
  assert.equal(identityFromClaims(claimsOk({ upn: undefined })).upn, "");
  assert.equal(
    identityFromClaims(claimsOk({ upn: undefined, preferred_username: "pu@legalprime.fr" })).upn,
    "pu@legalprime.fr"
  );
  assert.equal(
    identityFromClaims(claimsOk({ upn: undefined, email: "e@legalprime.fr" })).upn,
    "e@legalprime.fr"
  );
});
