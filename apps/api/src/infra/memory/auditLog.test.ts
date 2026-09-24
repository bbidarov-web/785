import { describe, expect, it } from 'vitest';
import { InMemoryAuditLog } from './auditLog.js';
import { TestClock } from './systemClock.js';

describe('InMemoryAuditLog — цепочка хешей поверх append-only журнала', () => {
  it('свежий журнал без записей — цепочка цела', async () => {
    const log = new InMemoryAuditLog(new TestClock());
    expect(await log.verifyChain()).toEqual({ ok: true, brokenAtSeq: null });
  });

  it('серия обычных append() даёт цельную цепочку', async () => {
    const log = new InMemoryAuditLog(new TestClock());
    for (let i = 0; i < 5; i++) {
      await log.append({ actorId: 'acc_1', actorRole: 'clinic_admin', tenantInn: '7712345671', action: `test:${i}`, target: null, meta: null, allowed: true });
    }
    expect(await log.verifyChain()).toEqual({ ok: true, brokenAtSeq: null });
    const rows = await log.list({});
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.hash && typeof r.hash === 'string')).toBe(true);
  });

  it('каждая запись цепляется за hash предыдущей — seq и prevHash идут по цепочке', async () => {
    const log = new InMemoryAuditLog(new TestClock());
    await log.append({ actorId: 'a', actorRole: 'clinic_admin', tenantInn: null, action: 'x', target: null, meta: null, allowed: true });
    await log.append({ actorId: 'b', actorRole: 'clinic_admin', tenantInn: null, action: 'y', target: null, meta: null, allowed: true });
    const [first, second] = (await log.list({})).sort((a, b) => a.seq - b.seq);
    expect(first!.prevHash).toBeNull();
    expect(second!.prevHash).toBe(first!.hash);
  });

  it('два журнала с РАЗНЫМИ секретами дают разные хеши для тех же данных', async () => {
    const clock = new TestClock();
    const logA = new InMemoryAuditLog(clock, 'секрет-А-минимум-тридцать-два-символа-хх');
    const logB = new InMemoryAuditLog(clock, 'секрет-Б-минимум-тридцать-два-символа-хх');
    await logA.append({ actorId: 'a', actorRole: 'clinic_admin', tenantInn: null, action: 'x', target: null, meta: null, allowed: true });
    await logB.append({ actorId: 'a', actorRole: 'clinic_admin', tenantInn: null, action: 'x', target: null, meta: null, allowed: true });
    const [rowA] = await logA.list({});
    const [rowB] = await logB.list({});
    expect(rowA!.hash).not.toBe(rowB!.hash);
  });
});
