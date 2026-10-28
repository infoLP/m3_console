-- Authentification locale par mot de passe.
--
-- Temporaire, en attendant le SSO Windows Entra : le serveur est fermé au public
-- et le site tourne en local. Le jour du SSO, `login` portant déjà l'UPN complet
-- (prenom.nom@legalprime.fr), le rattachement des comptes sera direct — le claim
-- upn / preferred_username rend exactement cette valeur.

-- Empreinte scrypt, au format scrypt$N$r$p$sel$empreinte (cf. src/lib/auth.js).
-- NULL = compte qui ne peut pas se connecter : c'est l'état des comptes de
-- démonstration, et celui d'un compte créé au back-office sans mot de passe.
ALTER TABLE users ADD COLUMN password_hash  text;
ALTER TABLE users ADD COLUMN password_set_at timestamptz;

-- Le login est l'identifiant de connexion : il doit être unique, et la
-- comparaison se fait sans tenir compte de la casse (une adresse Entra saisie
-- en majuscules doit joindre le même compte).
CREATE UNIQUE INDEX users_login_key ON users (lower(login));

-- Sessions côté serveur plutôt que cookie signé : révocables une par une, et
-- elles survivent à un redémarrage du conteneur — un secret de signature
-- régénéré au démarrage déconnecterait tout le monde à chaque redéploiement.
CREATE TABLE sessions (
  id         text PRIMARY KEY,               -- jeton aléatoire, 32 octets en base64url
  user_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen  timestamptz NOT NULL DEFAULT now(),
  user_agent text
);
CREATE INDEX ON sessions (user_id);
CREATE INDEX ON sessions (expires_at);
