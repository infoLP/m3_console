-- M3 — zone de chaque source (M3-78, zones couvertes paramétrables M3-74).
--
-- Une source porte désormais un NIVEAU de rattachement :
--   commune     — mairie, office de tourisme… (son département sert de repli)
--   departement — préfecture, conseil départemental, SDIS, chambre… (idem)
--   region      — conseil régional, DREAL, ADEME régionale… (repli : portée régionale)
--   nationale   — EFS, SUEZ, ANTS… (aucun repli : seul le contenu situe l'article)
-- NULL = non renseigné. Une source sans niveau mais avec un `dept` garde le
-- comportement d'avant cette migration (repli sur ce département) : aucune
-- donnée n'est donc reprise ici.
--
-- `region` : code INSEE de la région (« 75 » = Nouvelle-Aquitaine), utile au seul
-- niveau `region` — pour les autres, la région se déduit du département.
-- `dept` n'avait pas de contrainte en base ; c'est normalizeSource (yamlStore.js)
-- qui le bornait à la Nouvelle-Aquitaine. Il accepte maintenant tout département.

ALTER TABLE sources ADD COLUMN scope_level text
  CHECK (scope_level IS NULL OR scope_level IN ('commune', 'departement', 'region', 'nationale'));
ALTER TABLE sources ADD COLUMN region text;
