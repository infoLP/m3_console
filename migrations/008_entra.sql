-- M3 — raccordement au SSO Microsoft Entra ID (M3-42, lot 1 de docs/plans/archives/PLAN-sso-entra.md).
--
-- Armée le 2026-10-12, après le premier dump vérifié de m3db (M3-45 : 9/9 tables
-- restaurées). Jusque-là elle attendait à la racine, hors de `migrations/`, pour
-- ne pas partir au premier redéploiement sans point de retour. Essayée avant
-- d'être armée sur une copie restaurée de ce dump, sous le rôle m3_dbuser.
--
-- Ce fichier ne retire RIEN de l'authentification locale : `password_hash` et la
-- table `sessions` restent telles quelles. C'est voulu — tant que `M3_AUTH_MODE`
-- peut valoir `local` ou `both`, supprimer le mot de passe fermerait la seule
-- porte de secours le jour où le secret Entra expire (cf. §5.4 du plan). Le
-- ménage est le lot 4, pas celui-ci.
--
-- Numérotée 008 et non 003 : le plan réservait `003_entra.sql`, déjà pris par
-- `003_decision_trace.sql` livré entre-temps. La collision a été corrigée dans le
-- plan le 2026-09-17.

-- ---------------------------------------------------------------------------
-- Rattachement des comptes
--
-- `users.login` porte déjà l'UPN complet (a.sanchez@legalprime.fr) : la
-- première connexion se rattache donc par là, sans reprise de données. Mais un
-- UPN CHANGE — mariage, changement de nom, renommage de domaine — et Microsoft
-- documente `preferred_username` comme *mutable*, en déconseillant de s'en
-- servir pour autoriser. `oid` est immutable, propre au tenant, jamais
-- réattribué : on le mémorise à la première connexion et on rattache par lui
-- ensuite. Après quoi l'adresse peut changer librement, le compte suit.
ALTER TABLE users ADD COLUMN entra_oid text;

-- Partiel : les comptes locaux n'ont pas d'`oid`, et NULL n'est pas unique en
-- SQL — mais un index partiel dit l'intention plus clairement qu'un commentaire.
-- Deux comptes M3 ne peuvent pas pointer sur la même identité Entra.
CREATE UNIQUE INDEX users_entra_oid_key ON users (entra_oid) WHERE entra_oid IS NOT NULL;

-- Sert à deux choses : savoir si un compte provisionné s'est déjà connecté une
-- fois (donc si son `oid` est fiable), et repérer les comptes dormants le jour
-- où il faudra faire le ménage. Rempli par les deux modes, pas seulement Entra.
ALTER TABLE users ADD COLUMN last_login_at timestamptz;

-- ---------------------------------------------------------------------------
-- Transactions OIDC en cours
--
-- Entre /auth/login et /auth/callback, trois valeurs doivent survivre à un
-- aller-retour par login.microsoftonline.com sans jamais passer par le
-- navigateur en clair :
--   state         — anti-CSRF : la réponse qui revient doit citer un state QUE
--                   NOUS avons émis, sinon elle n'est pas la réponse à notre
--                   demande ;
--   nonce         — anti-rejeu : il est scellé DANS l'id_token par Entra, donc
--                   un jeton volé ailleurs ne portera pas le nôtre ;
--   code_verifier — PKCE : seul celui qui a émis la demande peut échanger le
--                   code, même si le code fuite.
--
-- En base plutôt qu'en mémoire : un redémarrage du conteneur pendant qu'une
-- personne est sur l'écran Microsoft ne doit pas transformer son retour en
-- échec incompréhensible. C'est le même raisonnement que pour `sessions`.
CREATE TABLE auth_requests (
  state         text PRIMARY KEY,               -- 32 octets aléatoires, base64url
  nonce         text        NOT NULL,
  code_verifier text        NOT NULL,
  -- Chemin interne d'où venait la personne, pour l'y renvoyer après connexion.
  -- Validé à l'écriture ET à la lecture : jamais une URL absolue, qui ferait de
  -- la page de connexion un tremplin vers un site tiers.
  next          text        NOT NULL DEFAULT '/',
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Durée de vie courte : le temps de taper un mot de passe et de valider un
  -- MFA, pas celui d'une pause déjeuner. Une demande expirée est un refus, pas
  -- une session.
  expires_at    timestamptz NOT NULL
);

-- Le nettoyage se fait au fil de l'eau (cf. pruneAuthRequests), par balayage de
-- cette colonne : sans index, la purge coûterait un parcours complet à chaque
-- connexion.
CREATE INDEX ON auth_requests (expires_at);
