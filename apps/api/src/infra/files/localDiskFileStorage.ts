import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileStorage } from '../../domain/ports.js';

/**
 * Локальный диск — временная реализация на первый VPS-деплой. SERVER.md §6.4
 * просит объектное хранилище с версиями и проверкой на вирусы; когда объём
 * файлов перерастёт один сервер, меняется только этот класс (порт тот же).
 * Каждый файл лежит как `<root>/<tenantInn>/<id>.bin` + `<id>.json` с contentType —
 * без БД, поскольку сами байты и так на диске, а не в Postgres.
 */
export class LocalDiskFileStorage implements FileStorage {
  constructor(private root: string) {}

  private dir(tenantInn: string): string {
    return path.join(this.root, tenantInn);
  }

  async save(tenantInn: string, contentType: string, data: Buffer): Promise<{ id: string; sizeBytes: number }> {
    const id = randomUUID();
    const dir = this.dir(tenantInn);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${id}.bin`), data);
    await writeFile(path.join(dir, `${id}.json`), JSON.stringify({ contentType }));
    return { id, sizeBytes: data.byteLength };
  }

  async read(tenantInn: string, id: string): Promise<{ contentType: string; data: Buffer } | null> {
    // id — UUID, сгенерированный этим же классом; но проверяем формат перед сборкой
    // пути на диске, чтобы значение из URL не могло выйти за пределы каталога арендатора
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    try {
      const dir = this.dir(tenantInn);
      const [data, metaRaw] = await Promise.all([readFile(path.join(dir, `${id}.bin`)), readFile(path.join(dir, `${id}.json`), 'utf8')]);
      const meta = JSON.parse(metaRaw) as { contentType: string };
      return { contentType: meta.contentType, data };
    } catch {
      return null;
    }
  }
}
