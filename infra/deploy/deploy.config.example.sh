#!/usr/bin/env bash
# Скопируйте в infra/deploy/deploy.config.sh (файл в .gitignore) и заполните
# своими значениями. scripts/deploy.sh подхватывает его автоматически.

DEPLOY_SSH_HOST="user@203.0.113.10"     # ваш VPS
DEPLOY_SSH_PORT="22"
DEPLOY_REMOTE_PATH="/opt/kontur785"     # куда разворачиваемся на сервере
DEPLOY_KEEP_RELEASES="5"                # сколько старых релизов хранить для отката
