import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskFileStorage } from './localDiskFileStorage.js';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('LocalDiskFileStorage', () => {
  let root: string;
  let store: LocalDiskFileStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'k785-files-'));
    store = new LocalDiskFileStorage(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('сохраняет и читает файл в границах арендатора вместе с контрольной суммой', async () => {
    const buf = Buffer.from('fake-jpeg-bytes');
    const saved = await store.save('7712345671', 'image/jpeg', buf);
    expect(saved.checksum).toBe(sha256(buf));
    const read = await store.read('7712345671', saved.id);
    expect(read?.data.equals(buf)).toBe(true);
    expect(read?.checksum).toBe(saved.checksum);
  });

  it('не отдаёт файл другому арендатору', async () => {
    const saved = await store.save('7712345671', 'image/jpeg', Buffer.from('x'));
    expect(await store.read('9999999999', saved.id)).toBeNull();
  });

  it('id не в виде UUID отклоняется без обращения к диску', async () => {
    expect(await store.read('7712345671', '../../etc/passwd')).toBeNull();
  });

  it('файл, сохранённый до появления контрольной суммы (нет checksum в .json), — считает её на лету', async () => {
    const saved = await store.save('7712345671', 'text/plain', Buffer.from('legacy'));
    // имитируем запись, сделанную старой версией адаптера — без поля checksum в метаданных
    await writeFile(path.join(root, '7712345671', `${saved.id}.json`), JSON.stringify({ contentType: 'text/plain' }));
    const read = await store.read('7712345671', saved.id);
    expect(read?.checksum).toBe(sha256(Buffer.from('legacy')));
  });
});
