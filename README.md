# m3_console

Extrait de M3 @ 1c1d201 par `scripts/decoupage/extraire-console.mjs` (dépôt M3). Ce qui vient de l'extraction ne s'édite pas à la main : on relance le script.

## Contrat avec le moteur (M3)

- **Base PostgreSQL = seul contrat.** La console dépose ses demandes dans la table `jobs` (types admis et clés kv : `shared/contrat.js`) ; le worker du moteur les traite.
- Elle lit l'état du moteur dans le kv `moteur/etat` (écrit par le worker à chaque battement).
- **Le schéma appartient au moteur** : M3 applique ses migrations au démarrage, la console n'en joue aucune. Déployer le moteur d'abord. `migrations/` n'est copié qu'en lecture, pour que `/api/health` compare la base aux migrations attendues.
- `M3_SECRET_KEY` identique des deux côtés (clés d'API chiffrées en base).

## Démarrer

```
cp .env.example .env   # DATABASE_URL au minimum
npm ci --prefer-offline --no-audit --no-fund
npm run dev            # http://localhost:4173
```

Image : `docker build -t m3_console .` (Next standalone, port 4173, sans migration).

## Scripts

- `npm run dev` : `next dev -p 4173`
- `npm run build` : `next build`
- `npm run start` : `next start`
- `npm run typecheck` : `next typegen && tsc --noEmit`
- `npm run lint` : `eslint --cache` (cache dans `.next/cache/eslint/`)
- `npm run test` : un seul `node --test` (tests `test/`, câblage `test/wiring/`, tranches `src/**/*.test.ts`)
- `npm run check:rapide` : typecheck, lint et tests en parallèle (`scripts/check.mjs --rapide`), sans compilation
- `npm run check` : idem, puis `npm run build` si tout est vert

Caches gardés d'une passe à l'autre, tous sous `.next/cache/` (que `next build` conserve et que la CI restaure) : compilation Turbopack, `tsconfig.tsbuildinfo` (tsc incrémental), lint. Un worktree neuf : `npm ci --prefer-offline --no-audit --no-fund`.

## Transformations appliquées par l'extraction

- `next.config.ts` : `output: "standalone"` (image légère ; config/, migrations/ et le gazetteer, lus par chemin, sont copiés par le Dockerfile).
- `test/oidc.test.js` (M3-98) : le nom `CONSOLE_CONNEXION_LOCALE` se vérifie dans `.env.example` au lieu de `docker-compose.yml` et `.env.docker.example`, restés au moteur.
- `package.json` réécrit : nom `m3_console`, scripts sans worker ni migration, dépendances = celles importées par l'arbre extrait (+ next, react, react-dom), outillage de M3 conservé.
- `package-lock.json` : celui de M3, élagué par `npm install --package-lock-only` (versions de M3 conservées).
- `Dockerfile`, `.dockerignore`, `.gitignore`, `.env.example`, ce README : produits par le script.
- `src/instrumentation.ts` gardé tel quel : il ne lance ni migration ni worker (crochet d'adresse IP et avertissements de configuration). Aucun module copié ne démarre le planificateur (`scheduleStatus` seul est importé).

## Données lues par chemin (copiées)

- `config/sources.public.baseline.yml` : lu par `src/lib/yamlStore.js`
- `config/sources.private.baseline.yml` : lu par `src/lib/yamlStore.js`
- `src/generate/communes.fr.json` : lu par `src/generate/geo.js`
- `migrations/` : lu par `src/diagnostiquerService/sante.js`

## Dette : modules moteur copiés (57)

Encore appelés en direct par la console. Chaque lot 3 du plan de découpage les remplace par une demande dans `jobs`, une lecture en base ou un module de `shared/`, puis les supprime d'ici (T26 : zéro copie).

- `src/generate/classify.js`
- `src/generate/dates.js`
- `src/generate/dedup.js`
- `src/generate/finalize.js`
- `src/generate/geo.js`
- `src/generate/pipeline.js`
- `src/generate/quality.js`
- `src/generate/relance.js`
- `src/ingest/competitorScan.js`
- `src/ingest/concurrents.js`
- `src/ingest/discoverFeeds.js`
- `src/ingest/fetchArticleList.js`
- `src/ingest/fetchFeed.js`
- `src/ingest/fetchPdf.js`
- `src/ingest/fetchRendered.js`
- `src/ingest/harvestRun.js`
- `src/ingest/links.js`
- `src/ingest/net.js`
- `src/ingest/page.js`
- `src/ingest/safeFetch.js`
- `src/ingest/sitemap.js`
- `src/jobs/queue.js`
- `src/lib/main.js`
- `src/lib/routineContext.js`
- `src/lib/runLock.js`
- `src/llm/allowlist.js`
- `src/llm/anthropic.js`
- `src/llm/budget.js`
- `src/llm/fallback.js`
- `src/llm/index.js`
- `src/llm/jsonLoose.js`
- `src/llm/lengthTarget.js`
- `src/llm/limits.js`
- `src/llm/mock.js`
- `src/llm/modelTests.js`
- `src/llm/openaiCompat.js`
- `src/llm/prompts/extract.js`
- `src/llm/prompts/generate.js`
- `src/llm/prompts/plagiarism.js`
- `src/llm/prompts/review.js`
- `src/llm/prompts/template.js`
- `src/llm/rules.js`
- `src/publish/illustration.js`
- `src/publish/illustrationUrl.js`
- `src/publish/index.js`
- `src/publish/payload.js`
- `src/publish/safeGet.js`
- `src/publish/seoPlugins.js`
- `src/publish/simulated.js`
- `src/publish/terms.js`
- `src/publish/wordpress.js`
- `src/publish/wpCheck.js`
- `src/publish/wpClient.js`
- `src/publish/wpConfig.js`
- `src/schedule/scheduler.js`
- `src/schedule/slots.js`
- `src/tools/rescore.js`

## Tests (103 fichiers gardés, 10 exclus)

Exclus (dépendent de code absent de la console) :

- `test/frontiere.test.js` : frontière propre à M3 (moteur absent ici)
- `test/ipBan.test.js` : importe src/tools/ipBanAdmin.js
- `test/jobs.test.js` : importe src/jobs/runner.js
- `test/llmBatch.test.js` : importe src/llm/batch.js
- `test/migration018.test.js` : teste une migration (migrations/018_recalcul_scores.mjs) : le schéma est au moteur
- `test/wiring/archivageAuto.test.js` : importe src/jobs/etat.js, src/jobs/runner.js, src/worker.js
- `test/wiring/chainCli.test.js` : importe src/tools/chain.js
- `test/wiring/jobsWiring.test.js` : importe src/jobs/runner.js
- `test/wiring/runLockClear.test.js` : importe src/jobs/etat.js, src/jobs/runner.js, src/worker.js
- `test/wiring/voies.test.js` : importe src/jobs/runner.js, src/jobs/taches/generate.js, src/jobs/taches/nonImplemente.js, src/jobs/taches/test_llm.js, src/jobs/taches/test_source.js

## Points ouverts

- `/api/health` (repris tel quel de M3) : 503 seulement si la base est injoignable ; un schéma en retard donne l'état `degrade` avec un statut 200, et la liste des migrations manquantes n'est visible qu'avec une session. Le plan veut 503 + migrations à jouer : à faire dans `src/diagnostiquerService/` (pas par l'extraction).
- Les modules moteur copiés tournent DANS la console (régénération, test de source, scan des concurrents…) jusqu'aux lots 3. Le rendu de repli (playwright/crawlee, `src/ingest/fetchRendered.js`) n'est pas installé ici : il échoue proprement (« rendu indisponible »).

## Variables d'environnement

Voir `.env.example` (avec, pour chacune, les fichiers qui la lisent).

- `CONSOLE_CONNEXION_LOCALE`
- `DATABASE_URL`
- `M3_AUTH_MODE`
- `M3_COOKIE_SECURE`
- `M3_ENTRA_CLIENT_ID`
- `M3_ENTRA_CLIENT_SECRET`
- `M3_ENTRA_DOMAIN_HINT`
- `M3_ENTRA_TENANT_ID`
- `M3_GEN_LIMIT`
- `M3_HARVEST_LIMIT`
- `M3_IP_BAN_EXEMPT`
- `M3_IP_BAN_THRESHOLD`
- `M3_IP_BAN_WINDOW_HOURS`
- `M3_LLM_ALLOWLIST_OPENROUTER`
- `M3_PASSWORD_LOGIN`
- `M3_PUBLIC_URL`
- `M3_PUBLISH_MODE`
- `M3_RENDER_FALLBACK`
- `M3_SCHEDULER`
- `M3_SECRET_KEY`
- `M3_SESSION_HOURS`
- `M3_TRUSTED_PROXIES`
- `M3_WP_APP_PASSWORD`
- `M3_WP_CREATE_CATEGORIES`
- `M3_WP_SEO_PLUGIN`
- `M3_WP_URL`
- `M3_WP_USER`
- `OPENROUTER_API_KEY`
- `OPENROUTER_APP_NAME`
- `OPENROUTER_SITE_URL`
- `PORT`
