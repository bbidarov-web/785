import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REQUIRED = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  COOKIE_SECRET: 'x'.repeat(32),
  AUDIT_LOG_SECRET: 'y'.repeat(32),
};

/**
 * `loadEnv()` кеширует результат в модульной переменной — `vi.resetModules()` + динамический
 * импорт перед каждым тестом, иначе второй тест всегда получал бы ответ первого.
 */
async function freshLoadEnv() {
  vi.resetModules();
  const mod = await import('./env.js');
  return mod.loadEnv;
}

describe('env — конфигурация файлового хранилища (FILES_DRIVER)', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv, ...REQUIRED };
    for (const k of ['FILES_DRIVER', 'FILES_DIR', 'FILES_S3_BUCKET', 'FILES_S3_REGION', 'FILES_S3_ENDPOINT', 'FILES_S3_FORCE_PATH_STYLE']) {
      delete process.env[k];
    }
  });
  afterEach(() => {
    process.env = savedEnv;
  });

  it('по умолчанию (FILES_DRIVER не задан) — local с каталогом по умолчанию', async () => {
    const loadEnv = await freshLoadEnv();
    const env = loadEnv();
    expect(env.FILES_DRIVER).toBe('local');
    expect(env.FILES_DIR).toBe('./var/uploads');
  });

  it('FILES_DRIVER=s3 без FILES_S3_BUCKET — конфигурация отклоняется с понятной ошибкой', async () => {
    process.env.FILES_DRIVER = 's3';
    const loadEnv = await freshLoadEnv();
    expect(() => loadEnv()).toThrow(/FILES_S3_BUCKET/);
  });

  it('FILES_DRIVER=s3 с FILES_S3_BUCKET — принимается, доп. поля прокидываются как есть', async () => {
    process.env.FILES_DRIVER = 's3';
    process.env.FILES_S3_BUCKET = 'kontur785-files';
    process.env.FILES_S3_REGION = 'ru-central1';
    process.env.FILES_S3_FORCE_PATH_STYLE = 'true';
    const loadEnv = await freshLoadEnv();
    const env = loadEnv();
    expect(env.FILES_S3_BUCKET).toBe('kontur785-files');
    expect(env.FILES_S3_REGION).toBe('ru-central1');
    expect(env.FILES_S3_FORCE_PATH_STYLE).toBe(true);
  });
});
