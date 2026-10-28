-- M3 — demandes d'exécution déposées par le web, traitées par le worker
-- (phase 1 de docs/plans/PLAN-nextjs-migration.md).
--
-- Jusqu'ici, « Lancer une récupération » et « Lancer une génération » tournaient
-- DANS le processus du serveur web, sous le bail « chain », et la requête HTTP
-- durait tout le temps de la run. L'ordonnanceur, la récolte et la génération
-- quittent le serveur web pour un conteneur dédié (m3-worker) : le web n'exécute
-- plus rien de long, il dépose une demande ici, et le worker la prend.
--
-- Une ligne par demande. `started_at` nul = en attente ; `finished_at` nul avec
-- `started_at` posé = en cours ; `error` non nul = échouée (y compris « verrou
-- tenu » par une chaîne planifiée). `result` ne porte qu'un résumé : le détail
-- d'une récolte est déjà dans harvest/latest.json et la collection « runs ».
--
-- Rétention : 30 jours, purge quotidienne par le worker (src/jobs/queue.js).

CREATE TABLE jobs (
  id           bigserial   PRIMARY KEY,
  kind         text        NOT NULL CHECK (kind IN ('harvest', 'generate')),
  params       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  requested_by text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  worker       text,
  result       jsonb,
  error        text
);

-- Ce que le worker lit toutes les cinq secondes : les demandes en attente, dans
-- l'ordre d'arrivée. Index partiel : la table grossit, la file reste courte.
CREATE INDEX jobs_pending_idx ON jobs (requested_at, id) WHERE started_at IS NULL;
CREATE INDEX jobs_requested_idx ON jobs (requested_at DESC, id DESC);
