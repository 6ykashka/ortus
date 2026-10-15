# W1.01 · образ ortus-backend (S0-02, критика этапа 0 П-3, Q-W0.04-4): cmd/api, cmd/migrate, cmd/worker.
# Контекст сборки — корень репозитория (что попадает в контекст — backend/Dockerfile.dockerignore):
#   docker build -f backend/Dockerfile -t ortus-backend:ci .
# Точка входа — /app/api (HTTP_ADDR=0.0.0.0:8080); worker и migrate: --entrypoint /app/worker | /app/migrate.
# Базовые образы закреплены по digest (индекс мультиархитектурного образа); обновляет интегратор.

FROM golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-mod=readonly
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/api ./cmd/migrate ./cmd/worker

# distroless/static:nonroot — без оболочки и пакетного менеджера, пользователь nonroot (65532).
FROM gcr.io/distroless/static-debian13:nonroot@sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3
COPY --from=build /out/ /app/
ENV HTTP_ADDR=0.0.0.0:8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/api"]
