-- M3 — cibles de publication WordPress (M3-53).
--
-- Un site WordPress sur lequel M3 peut envoyer un article : adresse, compte,
-- mot de passe d'application (CHIFFRÉ, comme les clés d'API LLM : src/lib/secretBox.js,
-- jamais renvoyé à l'écran, seule l'empreinte `secret_hint` l'est), greffon SEO,
-- statut d'arrivée dans WordPress.
--
-- `publish_status` : 'draft' (l'article arrive en brouillon, un humain le met en
-- ligne côté WordPress) ou 'publish' (mise en ligne directe). Défaut 'draft' :
-- une cible neuve ne publie jamais seule.
--
-- Une seule cible par défaut à la fois (index unique partiel). `active` = false
-- retire la cible des choix sans perdre l'historique : les enregistrements de
-- `publications` gardent son adresse en clair.
--
-- Aucune ligne n'est créée ici : tant qu'aucune cible n'existe, rien ne part
-- vers WordPress, quel que soit M3_PUBLISH_MODE.

CREATE TABLE wp_targets (
  id                bigserial   PRIMARY KEY,
  name              text        NOT NULL,
  url               text        NOT NULL,
  wp_user           text        NOT NULL,
  secret_enc        text        NOT NULL,
  secret_hint       text        NOT NULL DEFAULT '',
  seo_plugin        text        NOT NULL DEFAULT 'none' CHECK (seo_plugin IN ('none', 'yoast', 'rankmath')),
  create_categories boolean     NOT NULL DEFAULT false,
  publish_status    text        NOT NULL DEFAULT 'draft' CHECK (publish_status IN ('draft', 'publish')),
  is_default        boolean     NOT NULL DEFAULT false,
  active            boolean     NOT NULL DEFAULT true,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX wp_targets_name_idx ON wp_targets (lower(name));
CREATE UNIQUE INDEX wp_targets_default_idx ON wp_targets (is_default) WHERE is_default;
