import { loadEnv } from './env.js';
import { getPrismaClient } from './infra/prisma/client.js';
import { buildContainer } from './container.js';
import { buildApp } from './app.js';

async function main() {
  const env = loadEnv();
  const prisma = getPrismaClient();
  const container = buildContainer(prisma);
  const app = await buildApp(container, { cookieSecret: env.COOKIE_SECRET, corsOrigin: env.CORS_ORIGIN });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

// server.ts — только исполняемая точка входа (`npm run dev` / `node dist/server.js`),
// её никто не импортирует: тесты используют buildApp() напрямую с in-memory адаптерами.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
