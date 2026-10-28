-- M3 — l'onglet Historique gagne « En attente de parution ».
--
-- `003_decision_trace.sql` ne couvrait que `publie` et `archive`. Un article
-- envoyé en parution avec une date planifiée passe en `valide`, pas en `publie` :
-- il n'apparaissait donc nulle part, alors que la décision éditoriale avait bien
-- été prise et tracée. Et rien ne le fera basculer en `publie` le jour dit — il
-- n'y a pas d'ordonnanceur (cf. TODO.md, « récupération planifiée ») : il serait
-- resté invisible indéfiniment.
--
-- Fichier séparé et non correction de 003, qui est déjà appliquée : la modifier
-- laisserait toute base déjà migrée sans le nouvel index, sans le moindre signal.

-- L'index est PARTIEL : sa clause WHERE doit lister exactement les statuts que
-- readHistory() interroge, sinon le planificateur ne peut plus s'en servir et le
-- tri retombe en seq scan sans que rien ne le dise.
DROP INDEX articles_history_idx;
CREATE INDEX articles_history_idx
  ON articles ((coalesce(decided_at, updated_at)) DESC, id DESC)
  WHERE status IN ('publie', 'archive', 'valide');

-- Même reprise que 003, pour les articles déjà validés : date approchée par
-- updated_at, marquée `legacy`, auteur laissé vide faute d'avoir jamais existé.
UPDATE articles
   SET doc = jsonb_set(doc, '{decision}', jsonb_build_object(
         'status', doc->>'status',
         'at',     to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'byId',   NULL::text,
         'byName', NULL::text,
         'byLogin', NULL::text,
         'byRole', NULL::text,
         'legacy', true
       ), true)
 WHERE doc->>'status' = 'valide'
   AND doc->'decision' IS NULL;

UPDATE articles
   SET decided_at = updated_at
 WHERE status = 'valide'
   AND decided_at IS NULL;
