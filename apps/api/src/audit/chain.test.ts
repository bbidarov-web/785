import { describe, expect, it } from 'vitest';
import { computeEntryHash, verifyChain } from './chain.js';
import type { AuditLogEntry } from '../domain/types.js';

const SECRET = 'test-secret-not-for-production-use-at-all-x';

function makeEntry(seq: number, prevHash: string | null, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  const base: Omit<AuditLogEntry, 'hash'> = {
    id: 'log_' + seq,
    seq,
    at: new Date(2026, 0, 1, 0, 0, seq),
    actorId: 'acc_1',
    actorRole: 'clinic_admin',
    tenantInn: '7712345671',
    action: 'test:action',
    target: null,
    meta: null,
    allowed: true,
    prevHash,
    ...overrides,
  };
  const hash = overrides.hash ?? computeEntryHash(SECRET, prevHash, base);
  return { ...base, hash };
}

describe('audit/chain — HMAC-цепочка журнала действий', () => {
  it('пустая цепочка — цела по определению', () => {
    expect(verifyChain(SECRET, [])).toEqual({ ok: true, brokenAtSeq: null });
  });

  it('корректно построенная цепочка проходит проверку', () => {
    const e1 = makeEntry(1, null);
    const e2 = makeEntry(2, e1.hash);
    const e3 = makeEntry(3, e2.hash);
    expect(verifyChain(SECRET, [e1, e2, e3])).toEqual({ ok: true, brokenAtSeq: null });
  });

  it('правка поля записи задним числом рвёт цепочку с этого места', () => {
    const e1 = makeEntry(1, null);
    const e2 = makeEntry(2, e1.hash);
    const tampered = { ...e2, action: 'подменённое действие' }; // hash не пересчитан — как при прямой правке в БД
    expect(verifyChain(SECRET, [e1, tampered])).toEqual({ ok: false, brokenAtSeq: 2 });
  });

  it('удаление записи из середины рвёт цепочку на следующей — prevHash больше не совпадает', () => {
    const e1 = makeEntry(1, null);
    const e2 = makeEntry(2, e1.hash);
    const e3 = makeEntry(3, e2.hash);
    expect(verifyChain(SECRET, [e1, e3])).toEqual({ ok: false, brokenAtSeq: 3 }); // e2 «удалена»
  });

  it('запись с неверным секретом (посчитана другим ключом) отклоняется', () => {
    const e1 = makeEntry(1, null);
    const wrongHash = computeEntryHash('другой-секрет-совсем-не-тот-минимум-32-символа', null, e1);
    expect(verifyChain(SECRET, [{ ...e1, hash: wrongHash }])).toEqual({ ok: false, brokenAtSeq: 1 });
  });
});
