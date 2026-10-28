-- M3 — prompts de génération par moteur et par modèle (M3-56).
--
-- Jusqu'ici le prompt de génération était unique et écrit dans le code. Un
-- modèle ne réagit pas comme un autre à la même consigne : on peut désormais
-- surcharger le prompt général pour un moteur, voire pour un modèle précis.
--
-- Table en AJOUT SEUL : chaque enregistrement est une nouvelle ligne, ce qui
-- garde l'historique complet des versions. La version courante d'un niveau est
-- la dernière ligne pour son couple (provider_id, model) :
--   provider_id NULL            → prompt général ;
--   provider_id posé, model NULL → tout le moteur ;
--   provider_id et model posés  → ce modèle seul.
-- template NULL = « revenir au niveau supérieur » (modèle → moteur → général),
-- sans effacer l'historique.

CREATE TABLE llm_prompts (
  id           bigserial   PRIMARY KEY,
  provider_id  text        NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
  model        text        NULL,
  template     text        NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text        NULL
);

CREATE INDEX llm_prompts_level_idx ON llm_prompts (provider_id, model, created_at DESC);
