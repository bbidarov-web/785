import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import type { FileStorage } from '../../domain/ports.js';

export interface S3FileStorageOptions {
  bucket: string;
  region?: string;
  /** Провайдер, отличный от AWS (Selectel/Yandex Object Storage/MinIO/VK Cloud) — свой endpoint. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Большинство S3-совместимых провайдеров вне AWS требуют path-style URL вместо virtual-hosted. */
  forcePathStyle?: boolean;
}

/**
 * Объектное хранилище (README «Что дальше», п.1) — замена `LocalDiskFileStorage` на первый
 * реальный деплой не одним сервером: файл не привязан к диску конкретного инстанса. Порт
 * (`FileStorage`) тот же самый, вызывающие сервисы (walk/service.ts — фото находок,
 * documents/render.ts) ничего не знают о выборе адаптера — он собирается в `container.ts`
 * по `FILES_DRIVER` (см. `.env.example`). Работает с любым S3-совместимым провайдером,
 * не только AWS — это важно для хостинга в РФ (README «Что дальше», п.3, 152-ФЗ): endpoint
 * и forcePathStyle настраиваются под Selectel/Yandex Object Storage/VK Cloud.
 */
export class S3FileStorage implements FileStorage {
  private client: S3Client;

  constructor(
    private opts: S3FileStorageOptions,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: opts.region ?? 'us-east-1',
        endpoint: opts.endpoint,
        forcePathStyle: opts.forcePathStyle,
        credentials:
          opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
      });
  }

  private key(tenantInn: string, id: string): string {
    // тот же принцип изоляции по арендатору, что и в LocalDiskFileStorage — префикс ИНН в ключе,
    // read() ниже проверяет, что файл читается ТЕМ же tenantInn, каким был сохранён
    return `${tenantInn}/${id}`;
  }

  async save(tenantInn: string, contentType: string, data: Buffer): Promise<{ id: string; sizeBytes: number }> {
    const id = randomUUID();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: this.key(tenantInn, id),
        Body: data,
        ContentType: contentType,
      }),
    );
    return { id, sizeBytes: data.byteLength };
  }

  async read(tenantInn: string, id: string): Promise<{ contentType: string; data: Buffer } | null> {
    // id — UUID, сгенерированный этим же классом; форма проверяется на входе, как и в
    // LocalDiskFileStorage, — не потому что S3-ключ уязвим к обходу каталога так же, как
    // путь на диске, а чтобы дефект в вызывающем коде не ушёл на реальный запрос к S3.
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.key(tenantInn, id) }));
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return { contentType: res.ContentType ?? 'application/octet-stream', data: Buffer.from(bytes) };
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'NoSuchKey') return null;
      throw err;
    }
  }
}
