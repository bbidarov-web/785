#!/usr/bin/env bash
# Откат на один из сохранённых релизов (rebuild из старого исходника + переключение
# симлинка current). Список релизов — без аргументов.
#
# Использование:
#   ./scripts/rollback.sh                — показать список релизов
#   ./scripts/rollback.sh 20260115120000 — откатиться на указанный релиз
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="$ROOT_DIR/infra/deploy/deploy.config.sh"
# shellcheck disable=SC1090
source "$CONFIG_FILE"

REMOTE="${DEPLOY_SSH_HOST}"
SSH="ssh -p ${DEPLOY_SSH_PORT}"
SHARED_PATH="${DEPLOY_REMOTE_PATH}/shared"

if [ $# -eq 0 ]; then
  echo "Текущий релиз:"
  $SSH "$REMOTE" "readlink '${DEPLOY_REMOTE_PATH}/current' || true"
  echo
  echo "Доступные релизы (новые сверху):"
  $SSH "$REMOTE" "cd '${DEPLOY_REMOTE_PATH}/releases' && ls -1t"
  exit 0
fi

RELEASE_ID="$1"
RELEASE_PATH="${DEPLOY_REMOTE_PATH}/releases/${RELEASE_ID}"

if ! $SSH "$REMOTE" "test -d '${RELEASE_PATH}'"; then
  echo "Релиз ${RELEASE_ID} не найден на сервере" >&2
  exit 1
fi

echo "==> Пересобираем и разворачиваем релиз ${RELEASE_ID}"
if $SSH "$REMOTE" "chmod +x '${RELEASE_PATH}/infra/deploy/release.sh' && '${RELEASE_PATH}/infra/deploy/release.sh' '${RELEASE_PATH}' '${SHARED_PATH}'"; then
  $SSH "$REMOTE" "ln -sfn '${RELEASE_PATH}' '${DEPLOY_REMOTE_PATH}/current'"
  echo "Откат на ${RELEASE_ID} завершён."
else
  echo "!! Откат не прошёл проверку здоровья — current не тронут." >&2
  exit 1
fi
