# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS build
WORKDIR /app

# Build environments on some servers run with a very low PID/thread budget.
# Keep Node/V8/libuv/npm concurrency as low as possible during image build.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    UV_THREADPOOL_SIZE=1 \
    NODE_OPTIONS=--v8-pool-size=1 \
    NPM_CONFIG_JOBS=1 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm pkg delete devDependencies.electron \
      devDependencies.electron-builder \
      devDependencies.concurrently \
      devDependencies.nodemon && \
    npm install --legacy-peer-deps --no-audit --no-fund --omit=optional --include=dev --package-lock=false

COPY . .
RUN npm run build
RUN npm prune --omit=dev --omit=optional --legacy-peer-deps --no-audit --no-fund

FROM --platform=$TARGETPLATFORM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
