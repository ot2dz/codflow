# syntax=docker/dockerfile:1
# Storefront (CodFlow theme02) — standalone Node server for Coolify.
# Build context is the repo root (monorepo: single root lockfile).
# Local:  docker build -f cod-astro/theme02/Dockerfile -t codflow-storefront-theme02 .

FROM node:22-alpine AS build
WORKDIR /app
ARG STOREFRONT_ALLOWED_DOMAINS
ENV DEPLOY_TARGET=node
ENV STOREFRONT_ALLOWED_DOMAINS=${STOREFRONT_ALLOWED_DOMAINS}
COPY package.json package-lock.json ./
COPY cod-shared/package.json cod-shared/
COPY cod-server/package.json cod-server/
COPY cod-client-astro/package.json cod-client-astro/
COPY cod-astro/theme02/package.json cod-astro/theme02/
RUN npm ci --workspace cod-astro-theme02 --include-workspace-root --ignore-scripts
COPY cod-astro/theme02 cod-astro/theme02
RUN npm run build --workspace cod-astro-theme02

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/cod-astro/theme02/dist ./dist
EXPOSE 3000
CMD ["node", "./dist/server/entry.mjs"]
