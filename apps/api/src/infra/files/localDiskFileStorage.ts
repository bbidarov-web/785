import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileStorage } from '../../domain/ports.js';

/**
 * Локальный диск — временная реализация на первый VPS-деплой. SERVER.md §6.4
 * просит объектное хранилище с версиями и проверкой на вирусы; когда объём
 * файлов перерастёт один сервер, меняется только этот класс (порт тот же).
 * Каждый файл лежит как `<root>/<tenantInn>/<id>.bin` + `<id>.json` с contentType
 * и контрольной суммой — без БД, поскольку сами байты и так на диске, а не в Postgres.
 */
export class LocalDiskFileStorage implements FileStorage {
  constructor(private root: string) {}

  private dir(tenantInn: string): string {
    return path.join(this.root, tenantInn);
  }

  async save(tenantInn: string, contentType: string, data: Buffer): Promise<{ id: string; sizeBytes: number; checksum: string }> {
    const id = randomUUID();
    const checksum = createHash('sha256').update(data).digest('hex');
    const dir = this.dir(tenantInn);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${id}.bin`), data);
    await writeFile(path.join(dir, `${id}.json`), JSON.stringify({ contentType, checksum }));
    return { id, sizeBytes: data.byteLength, checksum };
  }

  async read(tenantInn: string, id: string): Promise<{ contentType: string; data: Buffer; checksum: string } | null> {
    // id — UUID, сгенерированный этим же классом; но проверяем формат перед сборкой
    // пути на диске, чтобы значение из URL не могло выйти за пределы каталога арендатора
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    try {
      const dir = this.dir(tenantInn);
      const [data, metaRaw] = await Promise.all([readFile(path.join(dir, `${id}.bin`)), readFile(path.join(dir, `${id}.json`), 'utf8')]);
      const meta = JSON.parse(metaRaw) as { contentType: string; checksum?: string };
      // файлы, сохранённые до появления контрольной суммы, — считаем её на лету, а не пишем «неизвестно»
      const checksum = meta.checksum ?? createHash('sha256').update(data).digest('hex');
      return { contentType: meta.contentType, data, checksum };
    } catch {
      return null;
    }
  }
}
