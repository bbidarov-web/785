import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { S3FileStorage } from './s3FileStorage.js';

const sha256 = (s: string) => createHash('sha256').update(Buffer.from(s)).digest('hex');

function fakeClient(send: (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => unknown) {
  return { send } as unknown as S3Client;
}

describe('S3FileStorage', () => {
  it('save кладёт объект по ключу <tenantInn>/<id> с переданным contentType и возвращает размер', async () => {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const client = fakeClient((cmd) => {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      return {};
    });
    const store = new S3FileStorage({ bucket: 'my-bucket' }, client);

    const r = await store.save('7712345671', 'image/jpeg', Buffer.from('hello'));

    expect(r.sizeBytes).toBe(5);
    expect(r.checksum).toBe(sha256('hello'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('PutObjectCommand');
    expect(calls[0]!.input).toMatchObject({ Bucket: 'my-bucket', Key: `7712345671/${r.id}`, ContentType: 'image/jpeg', Metadata: { checksum: r.checksum } });
  });

  it('read по UUID из своего tenantInn возвращает contentType, данные и контрольную сумму из метаданных объекта', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const client = fakeClient(() => ({
      ContentType: 'application/pdf',
      Metadata: { checksum: 'stored-checksum' },
      Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('pdf-bytes')) },
    }));
    const store = new S3FileStorage({ bucket: 'b' }, client);

    const r = await store.read('7712345671', id);

    expect(r).toEqual({ contentType: 'application/pdf', data: Buffer.from('pdf-bytes'), checksum: 'stored-checksum' });
  });

  it('read объекта без нашей метки (загружен в обход адаптера) считает контрольную сумму на лету', async () => {
    const id = '44444444-4444-4444-4444-444444444444';
    const client = fakeClient(() => ({
      ContentType: 'application/pdf',
      Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('legacy-bytes')) },
    }));
    const store = new S3FileStorage({ bucket: 'b' }, client);

    const r = await store.read('7712345671', id);

    expect(r?.checksum).toBe(sha256('legacy-bytes'));
  });

  it('read отклоняет id, не похожий на UUID, не обращаясь к S3', async () => {
    const send = vi.fn();
    const store = new S3FileStorage({ bucket: 'b' }, fakeClient(send));

    expect(await store.read('7712345671', '../../etc/passwd')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('read превращает NoSuchKey в null, а не бросает', async () => {
    const id = '22222222-2222-2222-2222-222222222222';
    const client = fakeClient(() => {
      const err = new Error('not found') as Error & { name: string };
      err.name = 'NoSuchKey';
      throw err;
    });
    const store = new S3FileStorage({ bucket: 'b' }, client);

    expect(await store.read('7712345671', id)).toBeNull();
  });

  it('read пробрасывает любую другую ошибку S3 как есть', async () => {
    const id = '33333333-3333-3333-3333-333333333333';
    const client = fakeClient(() => {
      throw new Error('AccessDenied');
    });
    const store = new S3FileStorage({ bucket: 'b' }, client);

    await expect(store.read('7712345671', id)).rejects.toThrow('AccessDenied');
  });
});
