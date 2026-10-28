-- M3 — journal consultable au back-office (M3-81).
--
-- Jusqu'ici, le journal n'existait que dans les fichiers de logs/ : lisibles
-- depuis la machine, pas depuis l'application. Cette table en garde une copie
-- structurée, consultable par l'administrateur (onglet Journal).
--
-- Quatre catégories :
--   connexion — connexions, refus, SSO, déconnexions, « Voir comme » ;
--   action    — décisions sur les articles, paramètres, sources, utilisateurs,
--               moteurs LLM, purges ;
--   erreur    — erreurs serveur, base, et celles remontées par le navigateur ;
--   chaine    — récoltes, générations, chaînes planifiées, plafonds atteints,
--               sources mises à l'écart.
--
-- Rétention : 90 jours, purge quotidienne par le serveur (src/lib/journal.js).
-- Le journal porte des noms de personnes : la durée est bornée à dessein (RGPD).
-- Les fichiers de logs/ restent la trace complète ; cette table n'en est pas une
-- sauvegarde, et une écriture qui échoue ici n'interrompt jamais une requête.

CREATE TABLE journal (
  id          bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  category    text        NOT NULL CHECK (category IN ('connexion', 'action', 'erreur', 'chaine')),
  level       text        NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
  event       text        NOT NULL,
  actor_id    text,
  actor_name  text,
  actor_role  text,
  target      text,
  detail      jsonb
);

CREATE INDEX journal_at_idx ON journal (at DESC, id DESC);
CREATE INDEX journal_category_idx ON journal (category, at DESC);
