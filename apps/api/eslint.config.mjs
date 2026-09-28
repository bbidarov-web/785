import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'var/**', 'devServer.tmp.mts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // код проекта сознательно использует `any` в паре мест (внешние SDK без типов,
      // приведение generic-полезной нагрузки второй руки) — предупреждение, а не запрет
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // сервисы сплошь async без await там, где вся ветка синхронна (ранний возврат ошибки) —
      // не баг, форма ради единообразной сигнатуры Promise<Result<T>>
      '@typescript-eslint/require-await': 'off',
      // сервер логирует через pino (app.ts, logger: true) — случайный console.log в бизнес-коде
      // обычно означает забытую отладочную печать; там, где консоль нужна намеренно (dev-заглушка
      // уведомлений, разовый вывод скрипта), это отмечено соседним eslint-disable-next-line.
      'no-console': 'warn',
    },
  },
  {
    // одноразовые CLI-скрипты (создать админа, засеять эталонные каталоги) — консоль
    // это их единственный интерфейс с оператором, а не забытая отладочная печать.
    files: ['src/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
