import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { buildContainer } from '../container.js';

/**
 * Дымовая проверка миграции на настоящем Postgres (CI, `.github/workflows/ci.yml`):
 * `prisma migrate deploy` только применяет SQL и не гарантирует, что он совпадает
 * с тем, что ожидают Prisma-репозитории (infra/prisma/*) — опечатка в маппинге поля
 * или отсутствующая колонка проявится только при реальном запросе. Поднимает
 * приложение поверх PrismaClient и прогоняет один сквозной цикл: регистрация клиники
 * (accounts + tenants), логин (sessions), повторное чтение сессии, логаут — этого
 * достаточно, чтобы задеть все таблицы, кроме второй руки и каналов, не трогаемых
 * при обычной регистрации. Ничего не оставляет: единственная запись — тестовый ИНН,
 * которым реальная клиника пользоваться не будет.
 */
async function main() {
  const prisma = new PrismaClient();
  await prisma.$queryRaw`SELECT 1`;

  const container = buildContainer(prisma, {
    auditLogSecret: 'smoke-check-'.padEnd(32, '0'),
    emailFrom: 'smoke@example.com',
  });
  const app = await buildApp(container, { cookieSecret: 'smoke-check-'.padEnd(32, '0'), corsOrigin: 'http://localhost:3000', logger: false });
  await app.ready();

  const inn = '0000000000';
  const register = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { inn, login: 'smoketest', password: 'SmokeTest2026', password2: 'SmokeTest2026', fio: 'Smoke Test', side: 'clinic' },
  });
  if (register.statusCode !== 200) throw new Error(`register: ${register.statusCode} ${register.body}`);

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { inn, login: 'smoketest', password: 'SmokeTest2026' },
  });
  if (login.statusCode !== 200) throw new Error(`login: ${login.statusCode} ${login.body}`);
  const cookie = (login.headers['set-cookie'] as string | undefined)?.split(';')[0]?.split('=')[1];
  if (!cookie) throw new Error('login did not set a session cookie');

  const session = await app.inject({ method: 'GET', url: '/api/auth/session', cookies: { k785_session: cookie } });
  if (session.statusCode !== 200 || !session.json().session) throw new Error(`session: ${session.statusCode} ${session.body}`);

  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { k785_session: cookie } });
  if (logout.statusCode !== 200) throw new Error(`logout: ${logout.statusCode} ${logout.body}`);

  await app.close();
  await prisma.account.deleteMany({ where: { inn } });
  await prisma.tenant.deleteMany({ where: { inn } });
  await prisma.$disconnect();
  console.log('smoke-check-db: OK — регистрация → логин → сессия → логаут прошли на реальном Postgres после миграции');
}

main().catch((err) => {
  console.error('smoke-check-db: FAILED', err);
  process.exit(1);
});
