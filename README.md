# m3_console

Console Next.js de M3, extraite de M3 @ 1c1d201 par `scripts/decoupage/extraire-console.mjs` (dépôt M3), puis vidée du moteur par les lots du découpage (T19-T26). Le moteur (worker, récolte, génération, publication, planification, migrations) vit dans M3 seul.

## Contrat avec le moteur (M3)

- **Base PostgreSQL = seul contrat.** La console n'importe aucun module du moteur : `test/frontiere.test.js` interdit ses dossiers (`src/{ingest,generate,publish,llm,schedule,jobs,tools}`, `src/lib/{main,runLock,routineContext}.js`) et ses dépendances (playwright, crawlee, rss-parser, pdf-parse, cheerio, xlsx), tests compris.
- **Demandes** : la console dépose une ligne dans la table `jobs` (`src/lib/demandes.js`) ; le worker du moteur la traite dans sa voie (`VOIES` : chaîne, articles, fond, interactive). Types admis, voies, délais et clé de dédoublonnage : `shared/contrat.js`.
- **Lectures** : l'état du moteur dans le kv `moteur/etat` (`KV_MOTEUR_ETAT`, écrit à chaque battement : moteur IA effectif, mode de publication, planification) ; ce qu'il écrit d'autre dans `kv_documents` sous les clés du contrat (`KV_PLANIFICATION`, `KV_DEPENSES_LLM`, `KV_ETAT_SOURCES`, `KV_VERROU_SCAN`, `KV_PLANIF_CONCURRENTS`), et les tables métier (articles, runs, routines…).
- **`shared/contrat.js` est identique dans les deux dépôts.** Il appartient à l'intégrateur (manager D) : toute modification part de M3 et y est recopiée.
- **Le schéma appartient au moteur** : M3 joue ses migrations avant de démarrer son worker ; la console n'en a aucune copie. Déployer le moteur d'abord. `/api/health` compare la base à ce dont la console a besoin (`ATTENDUS`, `MIGRATION_MINIMALE` dans `src/diagnostiquerService/sante.regles.js`) et répond 503 si le schéma est en retard (migrations à jouer dans le rapport, avec une session).
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

## Données lues par chemin (copiées dans l'image)

- `config/sources.public.baseline.yml`, `config/sources.private.baseline.yml` : lus par `src/lib/yamlStore.js`

## Tests

`test/*.test.js`, `test/wiring/*.test.js` et les tranches `src/**/*.test.ts`. Ce qui teste le moteur (worker, voies, routines, migrations, liste blanche du modèle par défaut) est dans M3 ; la console teste ce qu'elle dépose et ce qu'elle lit.

## Variables d'environnement

Voir `.env.example` (avec, pour chacune, les fichiers qui la lisent). Celles du moteur (récolte, génération, publication WordPress, `M3_PUBLISH_MODE`, clés des moteurs IA) sont dans M3.

- `CONSOLE_CONNEXION_LOCALE`
- `DATABASE_URL`
- `M3_AUTH_MODE`
- `M3_COOKIE_SECURE`
- `M3_ENTRA_CLIENT_ID`
- `M3_ENTRA_CLIENT_SECRET`
- `M3_ENTRA_DOMAIN_HINT`
- `M3_ENTRA_TENANT_ID`
- `M3_IP_BAN_EXEMPT`
- `M3_IP_BAN_THRESHOLD`
- `M3_IP_BAN_WINDOW_HOURS`
- `M3_LLM_ALLOWLIST_OPENROUTER`
- `M3_PASSWORD_LOGIN`
- `M3_PUBLIC_URL`
- `M3_SCHEDULER`
- `M3_SECRET_KEY`
- `M3_SESSION_HOURS`
- `M3_TRUSTED_PROXIES`
- `PORT`
