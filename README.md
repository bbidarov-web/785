# Контур 785

SaaS для внутреннего контроля качества и безопасности медицинской деятельности
(Приказ Минздрава №785н). Продакшн-реализация прототипа из `reference/`
(`reference/README.md` — продукт и дизайн-токены, `reference/SERVER.md` —
архитектура переноса, `reference/CLAUDE.md` — неизменные правила продукта).

## Статус переноса

Перенос идёт по порядку из `reference/SERVER.md` §6: исполнитель → обход →
клиника → панель. Инфраструктура и общая логика (auth, RBAC, журнал действий,
вторая рука, выдача документов) — фундамент для ВСЕХ кабинетов и уже полностью
готовы и покрыты тестами.

| Слой | Статус |
|---|---|
| Схема БД (`apps/api/prisma/schema.prisma`) | готово |
| Аутентификация: пароль (argon2), 2FA, сброс пароля, сессии в БД | готово |
| RBAC — матрица `ROLES` проверяется на каждом эндпоинте | готово |
| Журнал действий (append-only, включая отказы) | готово |
| «Вторая рука» — движок + повышение роли | готово (движок общий, остальные 6 операций — по мере переноса экранов) |
| Выдача документов клинике (grant/revoke, версии) | готово |
| Версионированные каналы данных (замена localStorage) | готово |
| **Кабинет исполнителя** | **готово end-to-end** (API + UI, `/executor`) |
| Мобильный обход | не перенесён — заглушка `/walk` |
| Личный кабинет ВКК (клиника) | не перенесён — заглушка `/clinic` |
| Панель платформы (админ/методист/менеджер/рук. продаж) | не перенесён — заглушка `/panel` |
| Docker / деплой на VPS / rollback | готово |
| CI (typecheck + тесты + сборка) | готово (`.github/workflows/ci.yml`) |

Заглушки (`/clinic`, `/panel`, `/walk`) уже проверяют сессию и роль по-настоящему
(не бутафория) — просто не показывают перенесённый экран. См.
`apps/web/src/components/InProgressCabinet.tsx`.

**Не готово к продаже прямо сейчас** — честно, по `reference/SERVER.md` §7:
провайдер SMS/email (сейчас коды 2FA и сброса пароля уходят в лог сервера,
`ConsoleNotifier`), платёжный шлюз, хостинг в РФ + уведомление РКН (152-ФЗ),
и 3 оставшихся экрана. Список — раздел «Что дальше» ниже.

## Архитектура

```
kontur785/
├── reference/          # исходный прототип — эталон вида/поведения, не трогать
├── packages/shared/    # ROLES, права, ИНН/телефон/пароль-валидация — общий источник правды
├── apps/api/           # Fastify + Prisma + PostgreSQL
│   ├── src/domain/     # порты (интерфейсы репозиториев) и типы — hexagonal architecture
│   ├── src/infra/memory/   # in-memory адаптеры — для тестов, без БД
│   ├── src/infra/prisma/   # Postgres-адаптеры — для прод
│   ├── src/auth/        src/rbac/        src/secondHand/
│   ├── src/documents/   src/executor/    src/http/routes/
│   └── prisma/schema.prisma, hardening.sql
├── apps/web/            # Next.js (App Router, TypeScript)
│   └── src/app/executor/page.tsx   # готовый кабинет исполнителя
└── infra/               # docker-compose (dev/prod), Caddyfile, deploy/
```

Сервисы (`AuthService`, `SecondHandService`, `DocumentService`, `ExecutorService`)
работают через порты (`domain/ports.ts`) и не знают, что за ними — Postgres или
память. Это не архитектурная мода: именно поэтому у нас **47 честных тестов**
API, которые гоняются без поднятой базы данных за секунды, и HTTP-интеграционные
тесты (`src/http/app.test.ts`), проверяющие реальные cookie-сессии и 403/401 —
а не только «функция вернула true».

Матрица `ROLES` (`packages/shared/src/roles.ts`) перенесена дословно из
`reference/prototype/platform.js` — сервер проверяет ТУ ЖЕ матрицу, как того
требует `reference/CLAUDE.md`.

## Запуск локально

Требуется Node.js 20+, Docker (для Postgres), npm.

```bash
npm install
cp apps/api/.env.example apps/api/.env      # заполнить COOKIE_SECRET: openssl rand -hex 32
cp apps/web/.env.example apps/web/.env.local

docker compose -f infra/docker-compose.yml up -d   # только Postgres
npm run prisma:migrate                              # первая миграция схемы

npm run dev   # api на :4000, web на :3000
```

Откройте http://localhost:3000/executor. Демо-аккаунтов больше нет
(`reference/SERVER.md` §7) — зарегистрируйте клинику через
`POST /api/auth/register` (side=clinic), затем создайте исполнителя (role=nurse)
и войдите по ИНН+телефону+паролю.

## Тесты и проверка

```bash
npm run typecheck   # все три пакета
npm test            # 68 тестов: shared (21) + api (47, включая HTTP-слой)
npm run build       # shared → prisma generate → api → web
```

Все три команды сейчас проходят чисто — это гейт для `scripts/deploy.sh` и CI.

## Деплой на сервер (VPS по SSH)

```bash
cp infra/deploy/deploy.config.example.sh infra/deploy/deploy.config.sh
# заполнить DEPLOY_SSH_HOST/PORT/REMOTE_PATH

# на сервере один раз:
mkdir -p /opt/kontur785/shared
scp infra/deploy/.env.prod.example user@server:/opt/kontur785/shared/.env
# заполнить .env на сервере (COOKIE_SECRET, POSTGRES_PASSWORD, DOMAIN, ...)

./scripts/deploy.sh
```

`deploy.sh` — это то, что просили: **вносить изменения локально и переносить их
на рабочий развёрнутый сайт одной командой.** Схема — capistrano-style releases:

1. Локально прогоняются typecheck + тесты + сборка. Падает хоть один шаг —
   деплоя не будет, старая версия на сервере продолжает работать.
2. `rsync` копирует рабочую копию в `releases/<timestamp>` на сервере.
3. На сервере: `docker compose build`, `prisma migrate deploy`, `docker compose up -d`.
4. Проверка `/api/health`. Не прошла — симлинк `current` НЕ переключается,
   старый релиз как работал, так и работает (нулевой простой на неудачном деплое).
5. Успех — `current` переключается на новый релиз, старые релизы (кроме
   последних `DEPLOY_KEEP_RELEASES`) удаляются.

Откат без пересборки на любой сохранённый релиз: `./scripts/rollback.sh` (без
аргументов — список релизов), `./scripts/rollback.sh <id>` — откат.

Первый администратор платформы создаётся на сервере отдельной командой
(`reference/SERVER.md` §7, обязательная смена пароля при первом входе):

```bash
docker compose -f infra/docker-compose.prod.yml exec api \
  node dist/scripts/createAdmin.js --inn 7726345678 --login admin --password '<временный>' --fio "Фамилия И.О."
```

## Что дальше (по приоритету, `reference/SERVER.md` §6)

1. **Мобильный обход** (`/walk`) — следующий по плану переноса, заглушка уже
   проверяет роль (`auditor`/`nurse`).
2. **Личный кабинет ВКК** (`/clinic`) — самый большой экран прототипа (10 400
   строк), переносить блоками: этапы внедрения → документы → обход/аудиты →
   оборудование → самообследование.
3. **Панель платформы** (`/panel`) — включая пять оставшихся операций «второй
   руки» (публикация эталона/тарифов, удаление тарифа, массовая операция,
   подтверждение крупной оплаты, выдача без оплаты) — движок уже готов
   (`SecondHandService`), нужно вызвать `request(...)` из нужных экранов панели.
4. **Провайдер SMS/email** — заменить `ConsoleNotifier` (`apps/api/src/infra/memory/notifier.ts`)
   на реальный шлюз (см. `.env.example`: `SMS_PROVIDER_API_KEY`, `EMAIL_PROVIDER_API_KEY`).
5. **Платёжный шлюз** — эквайринг, счёт-оферта, автопродление (`reference/SERVER.md` §6.7).
6. **Хостинг в РФ + уведомление РКН** (152-ФЗ) — до продажи первому реальному
   клинике с персональными/медицинскими данными.
7. Чек-лист приёмки после переноса каждого экрана — `reference/SERVER.md` §9.

## Известные ограничения (говорим прямо, не прячем)

- `mustChange` (обязательная смена пароля после `createAdmin`/`adminSetPassword`)
  сейчас только возвращается в `/api/auth/session` — фронтенд должен сам
  показать экран смены пароля и не пускать дальше; сервер пока не блокирует
  остальные эндпоинты по этому флагу. Добавить перед первым реальным клиентом.
- Кабинет исполнителя на фронтенде — клиентский компонент (`'use client'`):
  до гидратации страница пустая (нет SSR данных сессии). Для остальных экранов
  стоит рассмотреть серверные компоненты с чтением cookie на сервере.
- Визуальная сверка с прототипом на 390/820/1440 px (`reference/CLAUDE.md`)
  не выполнялась в реальном браузере в рамках этой сессии — только
  `next build` и HTTP-смоук (страницы отдают 200, вёрстка не проверена глазами).
  Сделайте её перед показом клиенту.
- Единственный настоящий e2e прогон — HTTP-уровень (`apps/api/src/http/app.test.ts`),
  не браузерный. Playwright/Cypress ещё не подключены.
