-- M3 — file à deux voies (T17, lot 1 du découpage console/moteur,
-- PLANS/m3-decoupage-console-moteur-2026-10-28.md).
--
-- La console ne fera plus rien tourner du moteur : chaque bouton dépose une
-- demande ici. Le CHECK sur `kind` reste la liste des demandes admises, garde-fou
-- du contrat (miroir de shared/contrat.js JOB_KINDS). Les nouveaux types sont
-- admis dès maintenant ; le worker les clôt « non implémenté » tant que leur
-- lot (3A à 3G) ne les a pas branchés.
--
-- `dedup_key` : deux demandes de même clé ne s'empilent pas tant que la première
-- attend. L'index unique partiel le garantit même sous deux clics simultanés,
-- là où le SELECT puis INSERT d'avant laissait passer une course. Les demandes
-- déjà en base gardent une clé nulle : elles passent telles quelles.

ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN (
  'harvest', 'generate', 'test_models',
  'rescore', 'competitor_scan', 'restore_sources', 'regenerate', 'publish',
  'test_source', 'test_wp_target', 'test_llm', 'fetch_models', 'preview_prompt', 'resolve_communes'
));

ALTER TABLE jobs ADD COLUMN dedup_key text;

CREATE UNIQUE INDEX jobs_dedup_pending_uidx ON jobs (dedup_key)
  WHERE started_at IS NULL AND dedup_key IS NOT NULL;

-- Chaque voie du worker lit ses propres types en attente, toutes les 0,75 s
-- (interactive) ou 5 s (chaîne).
CREATE INDEX jobs_pending_kind_idx ON jobs (kind, requested_at, id) WHERE started_at IS NULL;
