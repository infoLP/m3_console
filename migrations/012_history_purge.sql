-- M3 — articles purgés consultables dans l'Historique (M3-79).
--
-- La purge du back-office ne supprime plus : elle passe chaque article au statut
-- `purge`, avec une décision datée et attribuée qui garde la précédente
-- (src/lib/store.js, clearArticles). L'onglet Historique lit désormais quatre
-- statuts (HISTORY_STATUSES) ; l'index partiel qui sert son tri doit les couvrir
-- tous, faute de quoi la catégorie « Purgés » trierait sans index, en silence.
--
-- Les articles déjà supprimés par les purges d'avant cette migration ne
-- reviennent pas : il n'en reste rien en base.

DROP INDEX articles_history_idx;
CREATE INDEX articles_history_idx
  ON articles ((coalesce(decided_at, updated_at)) DESC, id DESC)
  WHERE status IN ('publie', 'archive', 'valide', 'purge');
