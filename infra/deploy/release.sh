#!/usr/bin/env bash
# Выполняется НА СЕРВЕРЕ внутри каталога нового релиза (запускается по ssh
# из scripts/deploy.sh). Не запускать вручную, кроме отладки деплоя.
#
# Ожидает: $1 = путь к каталогу релиза, $2 = путь к /opt/kontur785/shared
set -euo pipefail

RELEASE_DIR="$1"
SHARED_DIR="$2"
COMPOSE_FILE="$RELEASE_DIR/infra/docker-compose.prod.yml"
ENV_FILE="$SHARED_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Нет $ENV_FILE — скопируйте infra/deploy/.env.prod.example на сервер и заполните" >&2
  exit 1
fi

cd "$RELEASE_DIR"

echo "==> Сборка образов"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build

echo "==> Поднимаем базу данных (если ещё не поднята) и ждём готовности"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d db
timeout 60 docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db sh -c 'until pg_isready -U "$POSTGRES_USER"; do sleep 1; done'

echo "==> Миграции БД (prisma migrate deploy)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm api npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

echo "==> Хардненинг журнала действий (только на первом релизе — идемпотентно)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db psql -U "$(grep -m1 ^POSTGRES_USER= "$ENV_FILE" | cut -d= -f2)" -d "$(grep -m1 ^POSTGRES_DB= "$ENV_FILE" | cut -d= -f2)" -f /dev/stdin < apps/api/prisma/hardening.sql || true

echo "==> Разворачиваем api/web/caddy"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans

echo "==> Проверка здоровья"
for i in $(seq 1 15); do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "==> OK: сервис здоров"
    exit 0
  fi
  sleep 2
done

echo "Сервис не прошёл проверку здоровья после деплоя" >&2
exit 1
