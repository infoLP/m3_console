-- M3 — une source peut appartenir à une organisation (M3-59).
--
-- Demandé au weekly du 2026-09-14 : grouper les sources d'origine similaire,
-- par exemple le magazine municipal, les communiqués et les documents d'une
-- même mairie. Le besoin grandit avec l'enrichissement du dept 17 (M3-50) :
-- ajouter des ETI multiplie les sources par organisation.
--
-- Rien dans le référentiel ne permettait de le faire : `commune` est saisie
-- librement (« LA ROCHELLE » et « La Rochelle » coexistent) et désigne un lieu,
-- pas un émetteur — La Rochelle compte seize sources de seize organisations.
-- D'où une colonne dédiée, éditable au back-office, et pré-remplie à la demande
-- par le nom de domaine (bouton « Pré-remplir par domaine »), que
-- l'administrateur corrige ensuite. Aucune valeur n'est posée ici : un domaine
-- partagé par deux organisations distinctes (plateforme commune, sous-domaines)
-- regrouperait à tort, et c'est à quelqu'un de le relire.
--
-- Colonne nullable, sans défaut : une migration instantanée, sans réécriture
-- de la table.

ALTER TABLE sources ADD COLUMN organisation text;
