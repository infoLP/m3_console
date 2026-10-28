-- M3 — les moteurs LLM deviennent configurables depuis le back-office.
--
-- Jusqu'ici le moteur était figé dans le code (un module par fournisseur) et sa
-- clé venait d'une variable d'environnement : en changer demandait un commit et
-- un redéploiement, et tester une clé demandait de l'écrire dans un fichier.
--
-- Désormais : une ligne par moteur, la clé chiffrée dans la base (AES-256-GCM,
-- cf. src/lib/secretBox.js), et le moteur actif désigné par le réglage
-- `llm_provider`.
--
-- LA CLÉ N'EST JAMAIS RENDUE PAR L'API. Seule `api_key_hint` — « sk-or-…2b69 »,
-- calculée avant chiffrement — remonte jusqu'au navigateur. C'est aussi la seule
-- colonne que l'on consulte en exploitation : `api_key_enc` ne se lit que par le
-- code, au moment de l'appel.

CREATE TABLE llm_providers (
  id            text PRIMARY KEY,
  label         text NOT NULL,

  -- Protocole de l'API, PAS le nom commercial. Il n'y en a que deux à écrire :
  -- OpenRouter, OpenAI, Google (endpoint de compatibilité), Mistral, Ollama et
  -- LM Studio parlent tous le dialecte OpenAI ; Anthropic a le sien
  -- (/v1/messages, en-tête x-api-key, version d'API obligatoire).
  kind          text NOT NULL CHECK (kind IN ('openai', 'anthropic')),

  base_url      text NOT NULL,
  api_key_enc   text,                       -- chiffré ; NULL = pas de clé posée
  api_key_hint  text,                       -- « sk-or-…2b69 », seul affichable

  -- Liste de modèles proposée au back-office. Alimentée à la main, ou par le
  -- bouton « Récupérer la liste » quand `fetch_models` est vrai.
  models            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  models_fetched_at timestamptz,
  fetch_models      boolean     NOT NULL DEFAULT true,

  default_model text,
  enabled       boolean NOT NULL DEFAULT false,
  position      int     NOT NULL DEFAULT 0,

  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Les quatre moteurs courants, pré-créés SANS clé et désactivés. C'est sur
-- l'URL de base et le protocole qu'on se trompe : les avoir justes d'avance
-- évite l'essentiel des erreurs de configuration.
--
-- Les modèles par défaut sont indicatifs et remplacés dès le premier
-- « Récupérer la liste ». Aucun appel réseau n'est fait ici.
-- ---------------------------------------------------------------------------
INSERT INTO llm_providers (id, label, kind, base_url, default_model, enabled, position) VALUES
  ('openrouter', 'OpenRouter', 'openai',    'https://openrouter.ai/api/v1',                    'mistralai/mistral-small-2603', false, 1),
  ('anthropic',  'Anthropic',  'anthropic', 'https://api.anthropic.com/v1',                    NULL,                           false, 2),
  ('openai',     'OpenAI',     'openai',    'https://api.openai.com/v1',                       NULL,                           false, 3),
  ('google',     'Google',     'openai',    'https://generativelanguage.googleapis.com/v1beta/openai', NULL,                   false, 4);

-- ---------------------------------------------------------------------------
-- Reprise : OpenRouter était le moteur en service, on le laisse en service avec
-- le modèle déjà réglé en base (migration 005). Sans cela, la mise à jour
-- couperait la génération réelle en silence.
--
-- La clé, elle, n'est PAS reprise : elle vit dans une variable d'environnement,
-- qu'une migration SQL ne voit pas. `src/llm/index.js` continue de l'accepter en
-- repli tant qu'aucune clé n'est posée au back-office.
-- ---------------------------------------------------------------------------
UPDATE llm_providers p
   SET enabled = true,
       default_model = coalesce(
         (SELECT s.value FROM settings s WHERE s.key = 'llm_model' AND s.value LIKE '%/%'),
         p.default_model)
 WHERE p.id = 'openrouter';

INSERT INTO settings (key, value) VALUES ('llm_provider', 'openrouter')
  ON CONFLICT (key) DO NOTHING;
