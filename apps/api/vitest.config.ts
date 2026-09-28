import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      // отчёт по всему исходнику, а не только по файлам, у которых хоть один тест уже есть —
      // иначе полностью непокрытый модуль просто не попадёт в цифру
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testUtil/**', 'src/scripts/**', 'src/infra/prisma/**'],
      // с запасом ниже фактического (77/63/83/84% на момент подключения) — ловит явную просадку
      // покрытия при рефакторинге, не требует держать процент тютелька в тютельку
      thresholds: {
        statements: 70,
        branches: 55,
        functions: 75,
        lines: 75,
      },
    },
  },
});
