# ---------------------------------------------------------------------------
# m3_console : la console Next.js de M3 (extraite de M3 @ 1c1d201).
# Une seule image : Next standalone sur node:24-alpine, port 4173.
#
# PAS DE MIGRATION AU DÉMARRAGE : le schéma appartient au moteur (dépôt M3),
# qui applique ses migrations avant de démarrer son worker. Déployer le moteur
# d'abord. migrations/ n'est copié ici qu'en lecture, pour /api/health (liste
# des migrations attendues).
# ---------------------------------------------------------------------------

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM node:24-alpine AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Europe/Paris \
    PORT=4173 \
    HOSTNAME=0.0.0.0
# tzdata : sans lui Alpine ignore TZ et reste en UTC.
RUN apk add --no-cache tzdata
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Lus par chemin à l'exécution (le traçage de Next ne les voit pas).
COPY --chown=node:node config ./config
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node src/generate/communes.fr.json ./src/generate/communes.fr.json
USER node
EXPOSE 4173
# /api/health : sans session, touche la base (wget : busybox de node:alpine).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/api/health" >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
