# syntax=docker/dockerfile:1
# Storefront (CodFlow theme01) — standalone Node server for Coolify.
# Build context is the repo root (monorepo: single root lockfile).
# Local:  docker build -f cod-astro/theme01/Dockerfile -t codflow-storefront .

FROM node:22-alpine AS build
WORKDIR /app
ENV DEPLOY_TARGET=node
COPY package.json package-lock.json ./
COPY cod-shared/package.json cod-shared/
COPY cod-server/package.json cod-server/
COPY cod-client-astro/package.json cod-client-astro/
COPY cod-astro/theme01/package.json cod-astro/theme01/
RUN npm ci
COPY cod-astro/theme01 cod-astro/theme01
RUN npm run build --workspace cod-astro-theme01

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/cod-astro/theme01/dist ./dist
EXPOSE 3000
CMD ["node", "./dist/server/entry.mjs"]
