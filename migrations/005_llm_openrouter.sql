-- M3 — bascule du LLM vers OpenRouter : rattrapage du réglage stocké.
--
-- `llm_model` vit en base depuis la migration PostgreSQL ; `config/settings.yml`
-- n'est plus lu qu'à la reprise one-off. Changer le fichier du dépôt ne change
-- donc RIEN sur un environnement déjà déployé — il garderait « mistral-medium-latest ».
--
-- Or cet identifiant est celui de l'API Mistral directe. Sur OpenRouter les
-- identifiants sont toujours préfixés par l'éditeur : l'appel partirait en HTTP 400
-- à chaque génération, et comme index.js se replie silencieusement sur le mock,
-- l'outil aurait continué à produire des articles factices sans que personne ne
-- voie passer d'erreur. C'est exactement le genre de panne qu'on ne remarque pas.
--
-- Seules les valeurs SANS « / » sont réécrites : un identifiant déjà préfixé a été
-- choisi délibérément au back-office, on n'y touche pas.

UPDATE settings
   SET value = CASE
         WHEN value LIKE 'mistral-medium%' THEN 'mistralai/mistral-medium-3-5'
         WHEN value LIKE 'mistral-large%'  THEN 'mistralai/mistral-large-2512'
         ELSE 'mistralai/mistral-small-2603'
       END
 WHERE key = 'llm_model'
   AND value NOT LIKE '%/%';
