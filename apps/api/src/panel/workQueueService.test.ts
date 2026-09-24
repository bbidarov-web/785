import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { WorkQueueService } from './workQueueService.js';
import { addDays, todayString } from '../shared/date.js';
import type { Account } from '../domain/types.js';
import type { StagePaymentState, SubscriptionState } from '../shared/channelShapes.js';

function makeAccount(role: Account['role'], id: string): Account {
  return {
    id, inn: '7726345678', login: id, phone: null, email: null, org: null,
    fio: 'Оператор', side: 'platform', role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const EMPTY_PAYMENT: StagePaymentState = { status: 'none', requestedAt: null, requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 0, accepted: false, acceptedAt: null, acceptedBy: null, offerAccepted: false, offerAcceptedAt: null, offerAcceptedBy: null };
const EMPTY_SUB: SubscriptionState = { tariffKey: null, status: 'none', startedAt: null, expiresAt: null, history: [] };

describe('WorkQueueService — очередь работы', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: WorkQueueService;
  const methodist = makeAccount('methodist', 'acc_methodist');
  const manager = makeAccount('sales_manager', 'acc_manager');
  const nurse = { ...makeAccount('nurse', 'acc_nurse'), side: 'clinic' as const, inn: '7712345671' };

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new WorkQueueService(repos);
    await repos.tenants.upsert('7712345671', 'Клиника 1');
  });

  it('без просрочек и клиника с обходом — очередь пуста', async () => {
    await repos.channels.set('tenant', '7712345671', 'walk_results', [{ date: todayString() }], { updatedBy: null });
    expect(await svc.list(methodist)).toEqual([]);
  });

  it('исполнитель клиники не видит очередь (нет clinic:read)', async () => {
    await expect(svc.list(nurse)).rejects.toThrow();
  });

  it('неоплаченный счёт младше 3 дней не считается просрочкой', async () => {
    await repos.channels.set('tenant', '7712345671', 'walk_results', [{ date: todayString() }], { updatedBy: null });
    const payments: Record<number, StagePaymentState> = { 1: { ...EMPTY_PAYMENT, status: 'pending', requestedAt: addDays(todayString(), -2), amount: 68000 } };
    await repos.channels.set('tenant', '7712345671', 'stage_paid', payments, { updatedBy: null });
    expect(await svc.list(methodist)).toEqual([]);
  });

  it('неоплаченный счёт старше 3 дней — задача «оплата не поступила»', async () => {
    await repos.channels.set('tenant', '7712345671', 'walk_results', [{ date: todayString() }], { updatedBy: null });
    const payments: Record<number, StagePaymentState> = { 1: { ...EMPTY_PAYMENT, status: 'pending', requestedAt: addDays(todayString(), -5), amount: 68000 } };
    await repos.channels.set('tenant', '7712345671', 'stage_paid', payments, { updatedBy: null });
    const tasks = await svc.list(methodist);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ category: 'money', severity: 'критично', tenantInn: '7712345671', state: 'new' });
  });

  it('подписка со статусом expired — задача «подписка закончилась без продления»', async () => {
    await repos.channels.set('tenant', '7712345671', 'walk_results', [{ date: todayString() }], { updatedBy: null });
    await repos.channels.set('tenant', '7712345671', 'subscription', { ...EMPTY_SUB, status: 'expired', expiresAt: '01.01.2026' }, { updatedBy: null });
    const tasks = await svc.list(methodist);
    expect(tasks.map((t) => t.title)).toContain('Подписка закончилась без продления');
  });

  it('клиника без единого обхода — задача, клиника с обходом — нет', async () => {
    const tasks = await svc.list(methodist);
    expect(tasks.map((t) => t.title)).toContain('Клиника без единого обхода');
    await repos.channels.set('tenant', '7712345671', 'walk_results', [{ date: todayString() }], { updatedBy: null });
    const after = await svc.list(methodist);
    expect(after.map((t) => t.title)).not.toContain('Клиника без единого обхода');
  });

  it('«взять в работу» меняет состояние задачи для всех, кто читает очередь', async () => {
    const id = 'no-audit:7712345671';
    const taken = await svc.take(manager, id);
    expect(taken.ok).toBe(true);
    const tasks = await svc.list(methodist);
    const task = tasks.find((t) => t.id === id);
    expect(task).toMatchObject({ state: 'in_progress', stateBy: manager.id });
  });

  it('«отложить» скрывает задачу до истечения 3 дней, потом она возвращается', async () => {
    const id = 'no-audit:7712345671';
    await svc.postpone(methodist, id);
    const tasks = await svc.list(methodist);
    expect(tasks.find((t) => t.id === id)?.state).toBe('postponed');
    // отложено на 3 дня в будущее — искусственно "перематываем", подменив postponedUntil на вчера
    const rec = await repos.channels.get<Record<string, unknown>>('platform', null, 'work_queue_state', {});
    const patched = { ...rec.data, [id]: { ...(rec.data[id] as object), postponedUntil: addDays(todayString(), -1) } };
    await repos.channels.set('platform', null, 'work_queue_state', patched, { expectedVersion: rec.version, updatedBy: null });
    const after = await svc.list(methodist);
    expect(after.find((t) => t.id === id)?.state).toBe('new');
  });

  it('«закрыть» убирает задачу из списка в тот же день и возвращает её на следующий, если причина не исчезла', async () => {
    const id = 'no-audit:7712345671';
    await svc.close(methodist, id);
    expect((await svc.list(methodist)).find((t) => t.id === id)).toBeUndefined();

    // "переносим" запись закрытия на вчера — имитация следующего дня
    const rec = await repos.channels.get<Record<string, unknown>>('platform', null, 'work_queue_state', {});
    const patched = { ...rec.data, [id]: { ...(rec.data[id] as object), at: addDays(todayString(), -1) } };
    await repos.channels.set('platform', null, 'work_queue_state', patched, { expectedVersion: rec.version, updatedBy: null });
    const after = await svc.list(methodist);
    expect(after.find((t) => t.id === id)?.state).toBe('new');
  });

  it('дайджест: без получателя — понятная ошибка', async () => {
    const r = await svc.sendDigestNow(methodist);
    expect(r.ok).toBe(false);
  });

  it('дайджест: с получателем — уходит через Notifier и запоминает время отправки', async () => {
    await svc.saveDigestSettings(methodist, { recipientEmail: 'ops@standart-kachestva.ru', schedule: 'каждое утро, 09:00' });
    const r = await svc.sendDigestNow(methodist);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.taskCount).toBeGreaterThan(0);
    expect(r.settings.lastSentAt).toBe(todayString());
    expect(repos.notifier.sentDigests).toHaveLength(1);
    expect(repos.notifier.sentDigests[0]?.to).toBe('ops@standart-kachestva.ru');
  });
});
