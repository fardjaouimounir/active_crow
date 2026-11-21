FROM node:24-bookworm-slim AS workspace
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund

FROM workspace AS api
CMD ["npm", "run", "start", "-w", "@fieldflow/api"]

FROM workspace AS build-web
RUN npm run build -w @fieldflow/web

FROM nginx:alpine AS web
COPY docker/committee/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-web /app/apps/web/dist /usr/share/nginx/html
