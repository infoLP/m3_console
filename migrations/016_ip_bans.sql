-- M3 — liste noire d'adresses IP (M3-44).
--
-- Après M3_IP_BAN_THRESHOLD connexions par mot de passe refusées (15 par défaut)
-- depuis la même adresse, sur une fenêtre glissante, l'adresse est bannie : la
-- connexion par mot de passe lui est refusée jusqu'au débannissement (onglet
-- Sécurité du back-office, ou `node src/tools/ipBanAdmin.js --unban <ip>`).
--
-- En base et non en mémoire, contrairement à la limitation par identifiant de
-- src/lib/auth.js : un bannissement doit survivre au redémarrage et valoir pour
-- tous les conteneurs.
--
-- L'identifiant tenté est conservé, mais JAMAIS tel quel quand il ne correspond
-- à aucun compte : c'est souvent un mot de passe saisi dans le mauvais champ.
-- `logins` ne reçoit donc que des libellés déjà assainis par src/lib/ipBan.js
-- (identifiant complet si le compte existe, tronqué ou réduit à sa longueur
-- sinon).

-- Compteur de refus par adresse. Une ligne par adresse, remise à zéro quand la
-- fenêtre est dépassée, supprimée au bannissement ou à une connexion réussie.
CREATE TABLE ip_failures (
  ip        text        PRIMARY KEY,
  count     integer     NOT NULL DEFAULT 0,
  first_at  timestamptz NOT NULL DEFAULT now(),
  last_at   timestamptz NOT NULL DEFAULT now(),
  logins    text[]      NOT NULL DEFAULT '{}'
);

CREATE INDEX ip_failures_last_at_idx ON ip_failures (last_at);

-- La liste noire elle-même. `reason` : 'auto' (seuil atteint) ou 'manuel'
-- (posé depuis le back-office ou la ligne de commande). `banned_by` : nom de
-- l'administrateur pour un bannissement manuel, NULL sinon.
CREATE TABLE ip_bans (
  ip         text        PRIMARY KEY,
  banned_at  timestamptz NOT NULL DEFAULT now(),
  reason     text        NOT NULL CHECK (reason IN ('auto', 'manuel')),
  failures   integer     NOT NULL DEFAULT 0,
  logins     text[]      NOT NULL DEFAULT '{}',
  banned_by  text,
  note       text
);

CREATE INDEX ip_bans_banned_at_idx ON ip_bans (banned_at DESC);
