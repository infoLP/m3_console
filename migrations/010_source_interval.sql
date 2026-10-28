-- M3 — fréquence propre à chaque source (M3-58).
--
-- La récolte devient planifiée, plusieurs fois par jour s'il le faut. Une source
-- qui publie une fois par mois n'a pas à être interrogée à chaque créneau : on
-- lui donne un intervalle minimal entre deux récoltes, en jours.
--
-- NULL = pas de valeur explicite : l'intervalle se déduit alors du champ texte
-- `frequency`, déjà saisi pour la plupart des sources (« Mensuelle (estimée) »,
-- « Hebdomadaire à mensuelle »…), cf. src/ingest/sourceSchedule.js. 0 = à chaque
-- récolte, même si `frequency` dit autre chose.
--
-- L'état de récolte de chaque source (dernier succès, échecs d'affilée, mise à
-- l'écart) n'est PAS ici : le back-office réécrit la table entière à chaque
-- enregistrement, il écraserait ce que la récolte vient d'y noter. Il vit dans
-- kv_documents, clé `harvest/sources-state.json`.

ALTER TABLE sources ADD COLUMN interval_days int CHECK (interval_days IS NULL OR interval_days >= 0);
