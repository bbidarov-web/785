import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryFileStorage } from './fileStorage.js';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('InMemoryFileStorage', () => {
  it('сохраняет и читает файл по id в границах арендатора', async () => {
    const store = new InMemoryFileStorage();
    const buf = Buffer.from('fake-jpeg-bytes');
    const saved = await store.save('7712345671', 'image/jpeg', buf);
    expect(saved.sizeBytes).toBe(buf.byteLength);
    expect(saved.checksum).toBe(sha256(buf));
    const read = await store.read('7712345671', saved.id);
    expect(read?.contentType).toBe('image/jpeg');
    expect(read?.data.equals(buf)).toBe(true);
    expect(read?.checksum).toBe(saved.checksum);
  });

  it('контрольная сумма меняется вместе с содержимым', async () => {
    const store = new InMemoryFileStorage();
    const a = await store.save('7712345671', 'text/plain', Buffer.from('a'));
    const b = await store.save('7712345671', 'text/plain', Buffer.from('b'));
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('не отдаёт файл другому арендатору', async () => {
    const store = new InMemoryFileStorage();
    const saved = await store.save('7712345671', 'image/jpeg', Buffer.from('x'));
    const read = await store.read('9999999999', saved.id);
    expect(read).toBeNull();
  });

  it('неизвестный id возвращает null', async () => {
    const store = new InMemoryFileStorage();
    expect(await store.read('7712345671', 'ghost')).toBeNull();
  });
});
