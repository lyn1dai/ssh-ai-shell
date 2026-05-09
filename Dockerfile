# syntax=docker/dockerfile:1.7

# `bookworm` may fail on older Docker/runc hosts with uv_thread_create/clone3 issues.
# Keep the image overridable, but default to the more compatible bullseye variant.
ARG NODE_IMAGE=node:20-bullseye-slim

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps
WORKDIR /app

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --legacy-peer-deps

FROM deps AS build

COPY index.html ./
COPY vite.config.ts postcss.config.js tailwind.config.js tsconfig.json tsconfig.node.json ./
COPY src ./src
COPY server ./server
COPY shared ./shared
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

FROM --platform=$TARGETPLATFORM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
