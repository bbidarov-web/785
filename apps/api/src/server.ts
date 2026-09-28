import { loadEnv } from './env.js';
import { getPrismaClient } from './infra/prisma/client.js';
import { buildContainer } from './container.js';
import { buildApp } from './app.js';
import { startScheduler } from './scheduler.js';
import { buildFileStorage } from './infra/files/factory.js';

async function main() {
  const env = loadEnv();
  const prisma = getPrismaClient();
  const container = buildContainer(prisma, {
    auditLogSecret: env.AUDIT_LOG_SECRET,
    smsApiKey: env.SMS_PROVIDER_API_KEY,
    emailApiKey: env.EMAIL_PROVIDER_API_KEY,
    emailFrom: env.EMAIL_FROM,
    files: buildFileStorage(env),
  });
  const app = await buildApp(container, { cookieSecret: env.COOKIE_SECRET, corsOrigin: env.CORS_ORIGIN });

  const stopScheduler = startScheduler(container);
  app.addHook('onClose', async () => {
    stopScheduler();
    await prisma.$disconnect();
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

// server.ts — только исполняемая точка входа (`npm run dev` / `node dist/server.js`),
// её никто не импортирует: тесты используют buildApp() напрямую с in-memory адаптерами.
main().catch((err) => {
  // eslint-disable-next-line no-console -- падение при старте сервера обязано быть видно в stdout, логгер к этому моменту недоступен
  console.error(err);
  process.exit(1);
});
