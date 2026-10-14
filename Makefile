# Ортус CRM — цели для CI и Linux/macOS. Каждая цель — тонкая обёртка над одноимённым
# скриптом корневого package.json: логика живёт в одном месте.
# Windows без make: corepack pnpm run <цель>  (см. CLAUDE.md).
PNPM ?= pnpm

.PHONY: help install lint format typecheck test build dev gen up down migrate seed examples

help: ## список целей
	@node -e "require('fs').readFileSync('Makefile','utf8').split('\n').forEach(l=>{const m=l.match(/^([a-z-]+):.*## (.*)$$/);if(m)console.log(m[1].padEnd(10),m[2])})"

install: ## зависимости (frozen lockfile)
	$(PNPM) install --frozen-lockfile

lint: ## prettier --check, eslint, golangci-lint
	$(PNPM) run lint

format: ## prettier --write
	$(PNPM) run format

typecheck: ## tsc во всех пакетах
	$(PNPM) run typecheck

test: ## тесты каркаса, пакетов и go test
	$(PNPM) run test

build: ## сборка пакетов и go build
	$(PNPM) run build

dev: ## dev-сервер apps/web (W0.09)
	$(PNPM) run dev

gen: ## генерация по OpenAPI (W0.09)
	$(PNPM) run gen

up: ## стенд compose (W0.06)
	$(PNPM) run up

down: ## остановить стенд (W0.06)
	$(PNPM) run down

migrate: ## миграции (W0.06)
	$(PNPM) run migrate

seed: ## Go-сид (W0.06)
	$(PNPM) run seed

examples: ## пересъёмка примеров OpenAPI (W0.13, запускает интегратор)
	$(PNPM) run examples
