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
# Outils d'exploitation (T25c, R12) : créer le premier administrateur, lever un
# bannissement, par « docker exec <conteneur> node outils-console/userAdmin.js … ».
# Ils n'importent que src/lib (db, log, redact, racine, auth, main, ipBan,
# clientIp) et pg, déjà présent dans node_modules du standalone.
COPY --chown=node:node outils-console ./outils-console
COPY --chown=node:node src/lib ./src/lib
# Journal (src/lib/log.js) : /app appartient à root, logs/ doit être à node.
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node
EXPOSE 4173
# /api/health : sans session, touche la base (wget : busybox de node:alpine).
# 127.0.0.1 et non localhost : Alpine résout localhost en ::1, Next n'écoute qu'en IPv4.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
