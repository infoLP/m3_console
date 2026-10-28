-- M3 — fiches des articles effacés (T14, point projet du 27/10).
--
-- Un article PURGÉ depuis plus de `purge_retention_days` jours (réglage, 0 =
-- jamais) est effacé de `articles`. Il en reste ici une fiche minimale,
-- retrouvable par son UUID dans l'Historique : d'où il venait, quand et par qui
-- il a été récolté, généré, publié, archivé, purgé puis effacé. Elle sert aussi
-- à ne pas régénérer le même contenu source (`item_key`), sauf réarmement
-- explicite au moment de la purge.
--
-- `item_key` : l'identifiant du contenu source tel que la récolte le pose
-- (doc.origin.harvestItemId, « <sourceId>_<empreinte> », stable d'une récolte à
-- l'autre). C'est la clé de la génération, pas l'URL : `source_url` n'est
-- qu'informative.
--
-- Dates : `harvested_at` (origin.harvestedAt), `generated_at` (doc.createdAt),
-- `source_published_at` (parution de la source, origin.publishedAt),
-- `published_at` (parution de l'article, NULL s'il n'a jamais paru),
-- `archived_at`, `purged_at`, `erased_at`.
-- Auteurs : `generated_by` (le moteur, doc.provider), `purged_by`, `erased_by`
-- (« auto » ou le compte). Les auteurs des autres gestes sont dans `decisions`.
--
-- `decisions` : la chaîne des décisions, de la plus ancienne à la plus récente,
-- chaque entrée avec les clés de doc.decision (migration 003) : {status, at,
-- byId, byName, byLogin, byRole}, plus auto et afterHours s'ils sont présents.
-- `meta` : zone {num, dept, region, commune}, classement, prompt et modèle.
--
-- Aucune ligne n'est créée ici.

CREATE TABLE article_tombstones (
  id                  text        PRIMARY KEY,
  uuid                text        NOT NULL,
  title               text,
  cat                 text,
  mode                text,
  source_id           text,
  source_label        text,
  source_kind         text,
  source_url          text,
  item_key            text,
  harvested_at        timestamptz,
  generated_at        timestamptz,
  source_published_at timestamptz,
  published_at        timestamptz,
  archived_at         timestamptz,
  purged_at           timestamptz,
  erased_at           timestamptz NOT NULL DEFAULT now(),
  generated_by        text,
  purged_by           text,
  erased_by           text        NOT NULL,
  decisions           jsonb       NOT NULL DEFAULT '[]',
  meta                jsonb       NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX article_tombstones_uuid_idx ON article_tombstones (uuid);
CREATE INDEX article_tombstones_item_key_idx ON article_tombstones (item_key);
CREATE INDEX article_tombstones_source_id_idx ON article_tombstones (source_id);

-- Le filtre anti-régénération cherche un `item_key` à la fois dans les fiches
-- ci-dessus et dans les articles encore présents : même clé, indexée des deux
-- côtés. Colonne générée depuis `doc`, comme celles de 001.
ALTER TABLE articles ADD COLUMN item_key text GENERATED ALWAYS AS (doc#>>'{origin,harvestItemId}') STORED;
CREATE INDEX articles_item_key_idx ON articles (item_key);

-- La recherche par UUID de l'Historique lit d'abord `articles`, puis les fiches.
-- La colonne générée `uuid` existe depuis 001, sans index jusqu'ici.
CREATE INDEX articles_uuid_idx ON articles (uuid);
