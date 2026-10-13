# syntax=docker/dockerfile:1
# LeadPilot web app. Targets:
#   runner   (default) - production server from Next's standalone output, non-root
#   migrator           - applies migrations / runs the seed (needs dev dependencies + sources)

ARG NODE_IMAGE=node:22.23.3-alpine3.24

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Runtime configuration is parsed lazily (src/lib/configuration/env.ts), so no secrets are needed here.
RUN npm run build

FROM deps AS migrator
ENV NODE_ENV=production
COPY . .
USER node
CMD ["npm", "run", "db:migrate"]

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
