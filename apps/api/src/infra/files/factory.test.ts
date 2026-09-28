import { describe, expect, it } from 'vitest';
import { buildFileStorage } from './factory.js';
import { LocalDiskFileStorage } from './localDiskFileStorage.js';
import { S3FileStorage } from './s3FileStorage.js';
import type { Env } from '../../env.js';

const BASE: Env = {
  NODE_ENV: 'test',
  PORT: 4000,
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  COOKIE_SECRET: 'x'.repeat(32),
  AUDIT_LOG_SECRET: 'y'.repeat(32),
  CORS_ORIGIN: 'http://localhost:3000',
  EMAIL_FROM: 'Контур 785 <noreply@example.com>',
  FILES_DRIVER: 'local',
  FILES_DIR: './var/uploads',
};

describe('buildFileStorage', () => {
  it('FILES_DRIVER=local собирает LocalDiskFileStorage', () => {
    expect(buildFileStorage(BASE)).toBeInstanceOf(LocalDiskFileStorage);
  });

  it('FILES_DRIVER=s3 собирает S3FileStorage', () => {
    expect(buildFileStorage({ ...BASE, FILES_DRIVER: 's3', FILES_S3_BUCKET: 'b' })).toBeInstanceOf(S3FileStorage);
  });
});
