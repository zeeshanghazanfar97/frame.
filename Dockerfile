# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev
COPY . .
# Model files are checked in; deployment never fetches a different model revision.
RUN test -s public/models/hand_landmarker.task \
    && test -s public/models/wasm/vision_wasm_module_internal.wasm \
    && test -s public/models/dct-anime/model.json \
    && test -s public/models/dct-anime/weights.bin \
    && npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
