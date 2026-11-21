# syntax=docker/dockerfile:1
# LeadPilot web app, built by Render (render.yaml): the production server from Next's standalone output,
# non-root. Migrations run at startup (MIGRATE_ON_START).

ARG NODE_IMAGE=node:22.23.5-alpine3.24

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Runtime configuration is parsed lazily (src/lib/configuration/env.ts), so no secrets are needed here.
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# SQL migrations, applied at startup when MIGRATE_ON_START=true (src/instrumentation.ts; used on Render).
COPY --from=build --chown=node:node /app/database/migrations ./database/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
