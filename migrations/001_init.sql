-- M3 — schéma initial PostgreSQL.
--
-- Appliqué par src/tools/migrate.js. Une fois cette migration jouée sur un
-- environnement, ce fichier ne doit PLUS être modifié : toute évolution passe
-- par un nouveau fichier numéroté (002_…, 003_…).
--
-- La table schema_migrations n'est pas créée ici : elle appartient à
-- l'exécuteur, qui doit pouvoir la lire avant d'appliquer quoi que ce soit.

-- ---------------------------------------------------------------------------
-- Documents génériques clé → JSON. Remplace readJson/writeJson/dataPath :
-- harvest (latest, par date, seen) et collections cappées (notifications,
-- runs, tickets, publications).
-- ---------------------------------------------------------------------------
CREATE TABLE kv_documents (
  key        text PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Référentiel des sources. Colonnes calées sur SOURCE_KEYS (src/lib/yamlStore.js).
-- Les 322 sources parkées sont stockées ici aussi, avec kind = 'parked' :
-- readSources() ne lit que public + private, comme aujourd'hui.
-- ---------------------------------------------------------------------------
CREATE TABLE sources (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('public','private','parked')),
  category   text,
  commune    text,
  dept       text,
  type       text NOT NULL,
  site_url   text,
  list_url   text,
  press_url  text,
  rss_url    text,
  selector   text,
  frequency  text,
  priority   text,
  method     text,
  active     boolean NOT NULL DEFAULT false,
  -- Pas un horodatage : résultat du bouton « tester la source », de la forme
  -- {"http": 200, "at": "2026-09-04"}. 446 occurrences dans les YAML, toutes
  -- de cette forme.
  last_check jsonb,
  zone       jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Rang dans son référentiel. Les ids étant opaques (s-mu16c7tx), un tri
  -- alphabétique mélangerait la liste que l'administrateur voit au back-office :
  -- cette colonne reproduit l'ordre du fichier YAML d'origine.
  position   int     NOT NULL DEFAULT 0
);
CREATE INDEX ON sources (kind) WHERE kind <> 'parked';

-- ---------------------------------------------------------------------------
-- Réglages : 16 clés, cf. SETTING_SPECS. La validation et la coercition typée
-- restent en JavaScript — la base ne stocke que du texte brut, comme le YAML.
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE users (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  login    text NOT NULL,
  role     text NOT NULL
             CHECK (role IN ('administrateur','super_utilisateur','relecteur')),
  -- Même raison que pour sources : l'ordre de la liste est celui que le
  -- back-office affiche, les ids (u-admin, u-1757…) ne le reflètent pas.
  position int  NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Historique de configuration : remplace les .bak perdus à la bascule.
-- Alimentée en tête de writeSources / writeSettings / writeUsers avec l'état
-- AVANT modification (sémantique exacte du copyFile vers .bak).
-- ---------------------------------------------------------------------------
CREATE TABLE config_history (
  id      bigserial PRIMARY KEY,
  scope   text        NOT NULL CHECK (scope IN ('sources','settings','users')),
  payload jsonb       NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  author  text
);
CREATE INDEX ON config_history (scope, at DESC);

-- ---------------------------------------------------------------------------
-- Articles : le document complet en JSONB, plus les colonnes nécessaires au
-- filtrage et au tri.
--
-- created_at / updated_at sont des colonnes RÉELLES et non générées : un cast
-- text -> timestamp(tz) n'est pas immutable (il dépend du fuseau et de
-- DateStyle de la session), et PostgreSQL refuse alors la colonne générée.
-- Elles sont écrites par writeArticle() depuis doc->>'createdAt'/'updatedAt'.
--
-- signs / reading / zone_class sont les 3 dérivées calculées en JavaScript
-- (shared/scoring.js, shared/model.js) : la base ne sait pas les produire.
--
-- Le reste est généré par PostgreSQL et ne peut donc pas diverger du document.
-- ---------------------------------------------------------------------------
CREATE TABLE articles (
  id   text  PRIMARY KEY,
  doc  jsonb NOT NULL,

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  signs      int,
  reading    int,
  zone_class text,

  uuid             text    GENERATED ALWAYS AS (doc->>'uuid') STORED,
  title            text    GENERATED ALWAYS AS (doc->>'title') STORED,
  cat              text    GENERATED ALWAYS AS (doc->>'cat') STORED,
  status           text    GENERATED ALWAYS AS (doc->>'status') STORED,
  mode             text    GENERATED ALWAYS AS (doc->>'mode') STORED,
  ranking          int     GENERATED ALWAYS AS ((doc->>'ranking')::int) STORED,
  reviewer         text    GENERATED ALWAYS AS (doc->>'reviewer') STORED,
  -- coalesce indispensable : jsonb_typeof sur une clé absente rend NULL, alors
  -- que rebuildIndex() fait !!a.illustration et rend toujours un booléen.
  has_illustration boolean GENERATED ALWAYS AS
                     (coalesce(jsonb_typeof(doc->'illustration') = 'object', false)) STORED,
  source_label     text    GENERATED ALWAYS AS (doc#>>'{source,label}') STORED,
  source_kind      text    GENERATED ALWAYS AS (doc#>>'{source,kind}') STORED,
  source_id        text    GENERATED ALWAYS AS (doc#>>'{origin,sourceId}') STORED
);

-- Tri et pagination par curseur : WHERE (updated_at, id) < ($1, $2).
CREATE INDEX ON articles (updated_at DESC, id DESC);
-- Vue console par défaut : les archives restent consultables (décision 6) mais
-- n'alourdissent pas l'index le plus sollicité.
CREATE INDEX ON articles (status) WHERE status <> 'archive';
CREATE INDEX ON articles (source_id);
CREATE INDEX ON articles (zone_class);
