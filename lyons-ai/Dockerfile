# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    ARTIFACTS_DIR=/data/artifacts
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
# Chromium matching the installed playwright-core version, plus its OS dependencies.
RUN npx playwright-core install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.cache
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY package.json ./
RUN mkdir -p /data/artifacts && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/index.js"]
