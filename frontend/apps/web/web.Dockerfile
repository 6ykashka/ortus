# W1.01 · образ ortus-web (S0-02, критика этапа 0 П-3, Q-W0.04-4): статическая сборка @ortus/web (Vite).
# Контекст сборки — корень репозитория (что попадает в контекст — web.Dockerfile.dockerignore):
#   docker build -f frontend/apps/web/web.Dockerfile -t ortus-web:ci .
# Раздача — nginx-unprivileged (uid 101, порт 8080): статика и SPA-fallback на index.html. Прокси /api и TLS —
# деплой этапа 3. Базовые образы закреплены по digest; обновляет интегратор.

FROM node:22.19.0-alpine@sha256:d2166de198f26e17e5a442f537754dd616ab069c47cc57b889310a717e0abbf9 AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY frontend/ frontend/
RUN pnpm install --frozen-lockfile --filter "@ortus/web..."
RUN pnpm --filter @ortus/web run build

FROM nginxinc/nginx-unprivileged:1.30.0-alpine@sha256:808f7846d21a9c94cf53833e8807a00a33fd0b65cc47fb05b79efe366c2d201f
COPY --from=build /repo/frontend/apps/web/dist/ /usr/share/nginx/html/
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    server_name _;
    server_tokens off;
    root /usr/share/nginx/html;

    # Сборка Vite: имена с хешем содержимого — кешируются навсегда.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Content-Type-Options nosniff always;
        try_files $uri =404;
    }

    # W2.24: манифест PWA — в mime.types nginx нет webmanifest; блок types {} внутри server заменил бы
    # унаследованную карту типов, поэтому default_type только для этого пути.
    location = /manifest.webmanifest {
        default_type application/manifest+json;
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options nosniff always;
        try_files $uri =404;
    }

    # Маршруты SPA (TanStack Router): неизвестный путь отдаёт index.html, который не кешируется.
    location / {
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options nosniff always;
        try_files $uri $uri/ /index.html;
    }
}
EOF
USER 101
EXPOSE 8080
