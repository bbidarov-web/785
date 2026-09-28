import type { FileStorage } from '../../domain/ports.js';
import type { Env } from '../../env.js';
import { LocalDiskFileStorage } from './localDiskFileStorage.js';
import { S3FileStorage } from './s3FileStorage.js';

/** Выбор адаптера файлового хранилища по `FILES_DRIVER` (см. `.env.example`) — один раз, на старте сервера. */
export function buildFileStorage(env: Env): FileStorage {
  if (env.FILES_DRIVER === 's3') {
    return new S3FileStorage({
      bucket: env.FILES_S3_BUCKET!, // непустой — обеспечено env.ts (superRefine)
      region: env.FILES_S3_REGION,
      endpoint: env.FILES_S3_ENDPOINT,
      accessKeyId: env.FILES_S3_ACCESS_KEY_ID,
      secretAccessKey: env.FILES_S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.FILES_S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalDiskFileStorage(env.FILES_DIR);
}
