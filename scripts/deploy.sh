#!/usr/bin/env bash
# Деплой локальных изменений на рабочий сервер.
#
# Использование:
#   ./scripts/deploy.sh              — прогнать тесты, собрать, выложить на сервер
#   ./scripts/deploy.sh --skip-tests — пропустить локальные тесты (не для обычной работы)
#
# Что делает:
#   1. Локально: typecheck + тесты всех пакетов + сборка (падает — деплоя не будет)
#   2. rsync копирует рабочую копию в новый релиз на сервере: releases/<timestamp>
#   3. На сервере: docker compose build + prisma migrate deploy + docker compose up -d
#   4. Проверка здоровья (/api/health). Успех — переключаем симлинк `current`
#      на новый релиз. Неудача — `current` остаётся на предыдущем релизе,
#      старый контейнер продолжает работать (нулевой простой при неудачном деплое).
#   5. Старые релизы старше DEPLOY_KEEP_RELEASES штук удаляются.
#
# Откат на предыдущий релиз без пересборки: ./scripts/rollback.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="$ROOT_DIR/infra/deploy/deploy.config.sh"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Нет $CONFIG_FILE — скопируйте infra/deploy/deploy.config.example.sh и заполните" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG_FILE"

SKIP_TESTS=false
for arg in "$@"; do
  [ "$arg" = "--skip-tests" ] && SKIP_TESTS=true
done

if [ "$SKIP_TESTS" = false ]; then
  echo "==> [1/5] Проверка локально: typecheck + тесты + сборка"
  (cd "$ROOT_DIR" && npm run typecheck)
  (cd "$ROOT_DIR" && npm test)
  (cd "$ROOT_DIR" && npm run build)
else
  echo "==> [1/5] Локальные проверки пропущены (--skip-tests)"
fi

RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
REMOTE="${DEPLOY_SSH_HOST}"
SSH="ssh -p ${DEPLOY_SSH_PORT}"
RSYNC_SSH="ssh -p ${DEPLOY_SSH_PORT}"
RELEASE_PATH="${DEPLOY_REMOTE_PATH}/releases/${RELEASE_ID}"
SHARED_PATH="${DEPLOY_REMOTE_PATH}/shared"

echo "==> [2/5] Готовим каталоги релиза на сервере (${RELEASE_ID})"
$SSH "$REMOTE" "mkdir -p '${RELEASE_PATH}' '${SHARED_PATH}'"

echo "==> [3/5] Копируем рабочую копию (rsync)"
rsync -az --delete \
  -e "$RSYNC_SSH" \
  --exclude 'node_modules' --exclude '.git' --exclude '.next' --exclude 'dist' \
  --exclude '*.local.sh' --exclude 'infra/deploy/deploy.config.sh' \
  "$ROOT_DIR"/ "$REMOTE:$RELEASE_PATH/"

echo "==> [4/5] Собираем и разворачиваем на сервере"
if $SSH "$REMOTE" "chmod +x '${RELEASE_PATH}/infra/deploy/release.sh' && '${RELEASE_PATH}/infra/deploy/release.sh' '${RELEASE_PATH}' '${SHARED_PATH}'"; then
  echo "==> [5/5] Успех — переключаем current и подчищаем старые релизы"
  $SSH "$REMOTE" "ln -sfn '${RELEASE_PATH}' '${DEPLOY_REMOTE_PATH}/current' \
    && cd '${DEPLOY_REMOTE_PATH}/releases' \
    && ls -1t | tail -n +$((DEPLOY_KEEP_RELEASES + 1)) | xargs -r rm -rf"
  echo "Готово: ${RELEASE_ID} — https://\$DOMAIN (см. infra/deploy/.env.prod.example)"
else
  echo "!! Деплой релиза ${RELEASE_ID} не прошёл проверку здоровья." >&2
  echo "!! Предыдущий релиз (симлинк current) не тронут — сайт продолжает работать на нём." >&2
  echo "!! Разберитесь на сервере: ${RELEASE_PATH}, затем удалите каталог вручную." >&2
  exit 1
fi
