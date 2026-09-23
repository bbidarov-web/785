import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { BulkOperationService, type BulkActionDef } from './bulkService.js';
import { SecondHandService } from '../secondHand/service.js';
import type { Account } from '../domain/types.js';

function makeAccount(role: Account['role'], id: string): Account {
  return {
    id, inn: '7726345678', login: id, phone: null, email: null, org: null,
    fio: 'Гусев Р. А.', side: 'platform', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

describe('BulkOperationService — массовые операции по каталогу клиентов', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let secondHand: SecondHandService;
  let svc: BulkOperationService;
  const manager = makeAccount('sales_manager', 'acc_manager');
  const head = makeAccount('sales_head', 'acc_head');
  const methodist = makeAccount('methodist', 'acc_methodist');

  const touchNote: BulkActionDef = {
    label: 'Тестовая правка заметки', requestPermission: 'bulk:money', kind: 'money', undoable: true,
    channelKey: () => 'note',
    check: async (_repos, tenantInn) => (tenantInn === 'bad-inn' ? { ok: false, why: 'плохая клиника' } : { ok: true, preview: 'заметка будет установлена' }),
    apply: async (r, tenantInn, byId) => {
      await r.channels.set('tenant', tenantInn, 'note', { text: 'изменено', byId }, { updatedBy: byId });
    },
  };
  const remind: BulkActionDef = {
    label: 'Напоминание', requestPermission: 'money:write', kind: 'money', undoable: false,
    channelKey: () => null,
    check: async () => ({ ok: true, preview: 'ок' }),
    apply: async () => {},
  };

  beforeEach(async () => {
    repos = createMemoryRepos();
    secondHand = new SecondHandService(repos);
    svc = new BulkOperationService(repos, secondHand, { 'touch-note': touchNote, remind });
    await repos.tenants.upsert('inn-1', 'Клиника Один');
    await repos.tenants.upsert('inn-2', 'Клиника Два');
    await repos.channels.set('tenant', 'inn-1', 'note', { text: 'исходное' }, { updatedBy: null });
  });

  it('prepare требует право операции и отсеивает непригодные клиники с причиной', async () => {
    const r = await svc.prepare(manager, 'touch-note', ['inn-1', 'bad-inn']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      { inn: 'inn-1', name: 'Клиника Один', ok: true, why: '', preview: 'заметка будет установлена' },
      { inn: 'bad-inn', name: 'bad-inn', ok: false, why: 'плохая клиника', preview: '' },
    ]);
  });

  it('методист не может готовить денежную массовую операцию (нет bulk:money)', async () => {
    await expect(svc.prepare(methodist, 'touch-note', ['inn-1'])).rejects.toThrow();
  });

  it('без отмеченных клиник — понятная ошибка, а не пустой прогон', async () => {
    const r = await svc.prepare(manager, 'touch-note', []);
    expect(r.ok).toBe(false);
  });

  it('commit ≤20 клиник применяется сразу — отчёт с done/skipped и снимком для отката', async () => {
    const r = await svc.commit(manager, 'touch-note', ['inn-1', 'inn-2', 'bad-inn']);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.report) throw new Error('нет отчёта');
    expect(r.report.done.map((d) => d.inn).sort()).toEqual(['inn-1', 'inn-2']);
    expect(r.report.skipped).toEqual([{ inn: 'bad-inn', name: 'bad-inn', why: 'плохая клиника' }]);
    expect(r.report.undoable).toBe(true);

    const note = await repos.channels.get('tenant', 'inn-2', 'note', null);
    expect(note.data).toMatchObject({ text: 'изменено' });
  });

  it('применять не к кому — если все отмеченные клиники отсеяны проверкой', async () => {
    const r = await svc.commit(manager, 'touch-note', ['bad-inn']);
    expect(r.ok).toBe(false);
  });

  it('пачка больше SECOND_BULK (20) клиник уходит во вторую руку — без немедленного применения', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `bulk-${i}`);
    const r = await svc.commit(manager, 'touch-note', many);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.secondHandRequest).toBeDefined();
    expect(r.report).toBeUndefined();
    const note = await repos.channels.get('tenant', 'bulk-0', 'note', null);
    expect(note.data).toBeNull(); // ещё не применено

    const confirmed = await secondHand.confirm(r.secondHandRequest!.id, head.id, svc.applyFromSecondHand);
    expect(confirmed.ok).toBe(true);
    const noteAfter = await repos.channels.get('tenant', 'bulk-0', 'note', null);
    expect(noteAfter.data).toMatchObject({ text: 'изменено' });
  });

  it('откат восстанавливает снимок до операции по каждому затронутому каналу', async () => {
    const r = await svc.commit(manager, 'touch-note', ['inn-1']);
    if (!r.ok || !r.report) throw new Error('setup failed');

    const undone = await svc.undo(head, r.report.id);
    expect(undone.ok).toBe(true);
    const note = await repos.channels.get('tenant', 'inn-1', 'note', null);
    expect(note.data).toEqual({ text: 'исходное' });
  });

  it('повторный откат уже отменённой операции отклоняется', async () => {
    const r = await svc.commit(manager, 'touch-note', ['inn-1']);
    if (!r.ok || !r.report) throw new Error('setup failed');
    await svc.undo(head, r.report.id);
    const second = await svc.undo(head, r.report.id);
    expect(second.ok).toBe(false);
  });

  it('операция без undoable=true откатить нельзя', async () => {
    const r = await svc.commit(manager, 'remind', ['inn-1']);
    if (!r.ok || !r.report) throw new Error('setup failed');
    expect(r.report.undoable).toBe(false);
    const undone = await svc.undo(head, r.report.id);
    expect(undone.ok).toBe(false);
  });

  it('listReports возвращает применённые пачки, самые новые первыми', async () => {
    await svc.commit(manager, 'touch-note', ['inn-1']);
    await svc.commit(manager, 'remind', ['inn-2']);
    const reports = await svc.listReports(manager);
    expect(reports.map((r) => r.actionKey)).toEqual(['remind', 'touch-note']);
  });
});
