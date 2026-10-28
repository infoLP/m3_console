-- M3 — scan des concurrents et domaines sources candidats (M3-121, M3-122).
--
-- Le scan lit les derniers articles de chaque concurrent actif (020) et relève
-- les domaines qu'ils citent. Il tourne à part de la chaîne récolte →
-- génération : aux horaires `competitors_scan_times` quand
-- `competitors_scan_enabled` vaut « oui », ou par le bouton « Lancer le scan »
-- de Sources → Concurrents, même désactivé.
--
-- Sur `competitors`, le résultat du dernier scan de chaque site :
-- `last_scan_status` 'ok' (articles lus), 'vide' (aucun article trouvé) ou
-- 'erreur' (détail dans `last_scan_error`) ; `last_scan_via` dit par où les
-- articles ont été trouvés : 'page', 'flux' (RSS) ou 'sitemap'. NULL tant
-- qu'aucun scan n'est passé.

ALTER TABLE competitors
  ADD COLUMN last_scan_at     timestamptz,
  ADD COLUMN last_scan_status text CHECK (last_scan_status IN ('ok', 'vide', 'erreur')),
  ADD COLUMN last_scan_via    text CHECK (last_scan_via IN ('page', 'flux', 'sitemap')),
  ADD COLUMN last_scan_error  text;

-- Un domaine source candidat par ligne : domaine enregistrable, en minuscules
-- (normalisé par l'application). `status` : 'nouveau' (relevé, pas encore
-- montré), 'propose' (montré à l'administrateur), 'ajoute' (devenu une source),
-- 'ecarte' (refusé ; un nouveau scan ne le repropose pas). `decided_by` et
-- `decided_at` : qui a tranché, et quand.
--
-- `competitors` : [{id, label}] des concurrents qui le citent ; `articles` :
-- [{url, title, competitorId}] où il apparaît, bornés à 20 par l'application.
-- `occurrences` compte toutes les citations relevées, au-delà de ces 20.
--
-- Aucune ligne n'est créée ici.

CREATE TABLE competitor_candidates (
  id             bigserial   PRIMARY KEY,
  domain         text        NOT NULL,
  status         text        NOT NULL DEFAULT 'nouveau' CHECK (status IN ('nouveau', 'propose', 'ajoute', 'ecarte')),
  occurrences    integer     NOT NULL DEFAULT 0,
  competitors    jsonb       NOT NULL DEFAULT '[]',
  articles       jsonb       NOT NULL DEFAULT '[]',
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     text,
  decided_at     timestamptz
);

CREATE UNIQUE INDEX competitor_candidates_domain_idx ON competitor_candidates (domain);
CREATE INDEX competitor_candidates_status_idx ON competitor_candidates (status, last_seen_at DESC);
