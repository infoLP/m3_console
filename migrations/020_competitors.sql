-- M3 — sites concurrents (M3-120, lot 1 de M3-119).
--
-- La liste des sites concurrents, gérée depuis Sources → Concurrents
-- (administrateur et super-utilisateur, droit manage_competitors).
--
-- `url` est normalisée par l'application avant écriture (src/lib/competitors.js) :
-- http(s), hôte en minuscules, sans identifiants, paramètres ni fragment, sans
-- « / » final. L'index unique sur lower(url) refuse un doublon (409 côté appli).
--
-- `active` = false désactive le concurrent sans perdre la ligne : il n'est plus
-- crawlé (M3-121). Le crawl et les propositions (M3-121, M3-122) auront leurs
-- propres tables.
--
-- Aucune ligne n'est créée ici.

CREATE TABLE competitors (
  id          bigserial   PRIMARY KEY,
  label       text        NOT NULL,
  url         text        NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX competitors_url_idx ON competitors (lower(url));
