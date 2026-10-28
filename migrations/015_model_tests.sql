-- M3 — test des modèles du catalogue (onglet LLM, « Récupérer la liste »).
--
-- Jusqu'ici, le bouton ne faisait que remplir le catalogue : un modèle retiré,
-- sans crédit ou limité en débit restait sélectionnable, et on ne l'apprenait
-- qu'à la génération, repliée sur le mock. Désormais, la récupération dépose une
-- demande `test_models` : le worker émet un appel minimal (1 token) vers chaque
-- modèle et range ici le verdict, daté. Un modèle en échec reste visible, grisé.
--
-- `model_tests` : { startedAt, finishedAt, total, stopped, results: { <modèle>:
--   { ok, at, ms, status, motif } } }. Un seul document par moteur, remis à zéro
-- à chaque clic : tout est retesté, le document ne sert qu'à l'affichage entre
-- deux clics.

ALTER TABLE llm_providers
  ADD COLUMN model_tests jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Le type de demande s'ajoute à la contrainte de 014 (nom attribué par
-- PostgreSQL à une contrainte de colonne : <table>_<colonne>_check).
ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('harvest', 'generate', 'test_models'));
