/**
 * Создание первого администратора платформы (SERVER.md §7: "Первый администратор
 * платформы создаётся командой на сервере при развёртывании, с обязательной
 * сменой пароля при первом входе"). Обычная регистрация для side=operator
 * уходит в заявку (pending) — этому скрипту заявка не нужна, он единственный
 * раз создаёт запись напрямую и требует смены пароля.
 *
 * Запуск на сервере: docker compose exec api node dist/scripts/createAdmin.js \
 *   --inn 7726345678 --login admin --password '<временный пароль>' --fio "Фамилия И. О."
 */
import { validInn, passwordIssues } from '@kontur785/shared';
import { getPrismaClient } from '../infra/prisma/client.js';
import { hashPassword } from '../auth/hash.js';

function readArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const inn = readArg('inn');
  const login = readArg('login');
  const password = readArg('password');
  const fio = readArg('fio') ?? '';

  if (!inn || !login || !password) {
    console.error('Использование: --inn <ИНН оператора> --login <логин> --password <временный пароль> [--fio "Фамилия И.О."]');
    process.exit(1);
  }
  if (!validInn(inn)) {
    console.error('ИНН должен содержать 10 или 12 цифр');
    process.exit(1);
  }
  const issues = passwordIssues(password);
  if (issues.length) {
    console.error('Пароль: ' + issues.join(', '));
    process.exit(1);
  }

  const prisma = getPrismaClient();
  const existing = await prisma.account.findUnique({ where: { inn_login: { inn, login: login.toLowerCase() } } });
  if (existing) {
    console.error('Учётная запись с таким ИНН и логином уже существует');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const account = await prisma.account.create({
    data: {
      inn,
      login: login.toLowerCase(),
      fio,
      side: 'platform',
      role: 'platform_admin',
      pending: false,
      passwordHash,
      twoFactor: false,
      twoFactorVia: 'sms',
      mustChange: true, // обязательная смена пароля при первом входе
    },
  });

  console.log(`Создан администратор платформы: ${account.login} (ИНН ${account.inn}). Обязательна смена пароля при первом входе.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
