-- M3 — traçabilité des décisions éditoriales (onglet Historique).
--
-- Deux informations manquaient, et l'onglet Historique ne peut pas être honnête
-- sans elles :
--
--   * LA DATE. Personne ne stockait la date de publication ou d'archivage.
--     `src/api/ops.js` l'approchait par `updated_at`, qui bouge à la moindre
--     correction ultérieure : un article publié lundi et retouché jeudi
--     apparaissait publié jeudi. Seule `doc->'publication'->>'publishedAt'`
--     était juste, et seulement pour les publications immédiates.
--
--   * LA PERSONNE. La console envoyait `state.roleLabel` dans le champ
--     `reviewer` : la colonne contenait « Administrateur », pas un nom. Le
--     bloc « Activité par relecteur » du Suivi agrégeait donc par rôle, avec
--     au plus trois lignes, en laissant croire à un décompte par personne.
--
-- La décision vit désormais dans le document, sous la clé `decision` :
--
--   { "status": "publie" | "archive" | "valide",
--     "at": "2026-09-16T09:12:04.123Z",
--     "byId": "u-1757…", "byName": "…", "byLogin": "prenom.nom@…",
--     "byRole": "super_utilisateur",      -- rôle EFFECTIF au moment du geste
--     "legacy": true }                    -- seulement sur les lignes reprises

-- decided_at est une colonne RÉELLE et non générée, pour la raison déjà
-- documentée en tête de 001_init.sql : le cast text -> timestamptz n'est pas
-- immutable (il dépend du fuseau et de DateStyle de la session) et PostgreSQL
-- refuse alors la colonne générée. Elle est écrite par writeArticle() depuis
-- doc->'decision'->>'at', exactement comme created_at / updated_at.
ALTER TABLE articles ADD COLUMN decided_at timestamptz;

-- Le reste est généré : impossible de diverger du document.
ALTER TABLE articles ADD COLUMN decided_by      text GENERATED ALWAYS AS (doc#>>'{decision,byName}')  STORED;
ALTER TABLE articles ADD COLUMN decided_by_id   text GENERATED ALWAYS AS (doc#>>'{decision,byId}')    STORED;
ALTER TABLE articles ADD COLUMN decided_by_role text GENERATED ALWAYS AS (doc#>>'{decision,byRole}')  STORED;

-- coalesce indispensable, même raison que has_illustration : comparer un jsonb
-- ABSENT à 'true' rend NULL, pas false — la contrainte NOT NULL sauterait sur
-- tous les articles antérieurs.
-- Comparaison sur `#>>` (texte) et non `#>` (jsonb) : une expression de colonne
-- générée doit être immutable, et la comparaison de deux textes l'est sans
-- discussion possible — inutile de faire dépendre le schéma d'un cast.
ALTER TABLE articles ADD COLUMN decision_legacy boolean NOT NULL GENERATED ALWAYS AS
  (coalesce((doc#>>'{decision,legacy}') = 'true', false)) STORED;

-- Tri et pagination de l'onglet Historique : curseur (clé, id) décroissant, sur
-- les deux seuls statuts qu'il affiche. L'index porte sur coalesce(decided_at,
-- updated_at) et non sur decided_at seul : une ligne sans décision (impossible
-- après la reprise ci-dessous, mais rien ne l'interdit structurellement)
-- donnerait une clé de curseur NULL et couperait la pagination en silence.
CREATE INDEX articles_history_idx
  ON articles ((coalesce(decided_at, updated_at)) DESC, id DESC)
  WHERE status IN ('publie', 'archive');

-- ---------------------------------------------------------------------------
-- Reprise de l'existant (décision du 2026-09-16).
--
-- Les articles déjà publiés ou archivés n'ont aucune trace de décision. On
-- reprend `updated_at` comme date — c'est l'approximation que faisait déjà le
-- Suivi — et on marque la ligne `legacy` pour que l'interface le dise au lieu
-- de le laisser croire. L'auteur, lui, est définitivement perdu : il n'a jamais
-- été écrit nulle part, et le reconstituer à partir du rôle serait inventer.
--
-- Deux UPDATE ensemblistes sur les seules lignes concernées : on reste très
-- loin du « ne pas mélanger DDL et reprise volumineuse » de src/tools/migrate.js
-- (quelques centaines de lignes sur ce prototype).
-- ---------------------------------------------------------------------------

-- doc->>'status' plutôt que la colonne générée `status` : celle-ci est dérivée
-- de la colonne que l'UPDATE réécrit, autant lire la source directement.
UPDATE articles
   SET doc = jsonb_set(doc, '{decision}', jsonb_build_object(
         'status', doc->>'status',
         'at',     to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         -- NULL typés : jsonb_build_object est variadique "any" et ne sait pas
         -- quoi faire d'un NULL sans type.
         'byId',   NULL::text,
         'byName', NULL::text,
         'byLogin', NULL::text,
         'byRole', NULL::text,
         'legacy', true
       ), true)
 WHERE doc->>'status' IN ('publie', 'archive')
   AND doc->'decision' IS NULL;

UPDATE articles
   SET decided_at = updated_at
 WHERE status IN ('publie', 'archive')
   AND decided_at IS NULL;
