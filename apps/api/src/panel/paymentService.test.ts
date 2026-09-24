import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos, type MemoryRepos } from '../testUtil/memoryRepos.js';
import { PaymentService } from './paymentService.js';
import { SecondHandService } from '../secondHand/service.js';
import type { Account } from '../domain/types.js';
import type { StagePaymentState } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role'], side: Account['side']): Account {
  return {
    id: 'acc_' + role, inn: side === 'platform' ? '7726345678' : inn, login: role, phone: null, email: null, org: null,
    fio: role, side, role, pending: false, requestedRole: null,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

async function seedPending(repos: MemoryRepos, amount: number) {
  const payment: StagePaymentState = { status: 'pending', requestedAt: '01.03.2026', requestedBy: 'acc_clinic_admin', confirmedAt: null, confirmedBy: null, amount, accepted: false, acceptedAt: null, acceptedBy: null, offerAccepted: false, offerAcceptedAt: null, offerAcceptedBy: null };
  await repos.channels.set('tenant', inn, 'stage_paid', { 1: payment }, { updatedBy: null });
}

describe('PaymentService — подтверждение оплаты этапа', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: PaymentService;
  let secondHand: SecondHandService;
  const manager = makeAccount('sales_manager', 'platform');
  const salesHead = makeAccount('sales_head', 'platform');
  const methodist = makeAccount('methodist', 'platform');

  beforeEach(() => {
    repos = createMemoryRepos();
    secondHand = new SecondHandService(repos);
    svc = new PaymentService(repos, secondHand);
  });

  it('менеджер подтверждает оплату ниже порога второй руки напрямую', async () => {
    await seedPending(repos, 68000);
    const r = await svc.confirm(manager, inn, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payment?.status).toBe('paid');
  });

  it('методист не может подтвердить оплату (нет money:write) — дословное правило платформы', async () => {
    await seedPending(repos, 68000);
    await expect(svc.confirm(methodist, inn, 1)).rejects.toThrow();
  });

  it('оплата от 100 000 ₽ уходит в «вторую руку», а не применяется сразу', async () => {
    await seedPending(repos, 150000);
    const r = await svc.confirm(manager, inn, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.secondHandRequest).toBeDefined();
      expect(r.payment).toBeUndefined();
    }
    // платёж всё ещё pending — второй рукой пока никто не подтвердил
    const rec = await repos.channels.get<Record<number, StagePaymentState>>('tenant', inn, 'stage_paid', {});
    expect(rec.data[1]?.status).toBe('pending');
  });

  it('вторая рука: тот же менеджер не может подтвердить свой же запрос на крупную оплату', async () => {
    await seedPending(repos, 150000);
    const r = await svc.confirm(manager, inn, 1);
    if (!r.ok || !r.secondHandRequest) throw new Error('setup');
    const confirm = await secondHand.confirm(r.secondHandRequest.id, manager.id, svc.applyFromSecondHand);
    expect(confirm.ok).toBe(false);
  });

  it('вторая рука: другой сотрудник с money:write подтверждает крупную оплату', async () => {
    await seedPending(repos, 150000);
    const r = await svc.confirm(manager, inn, 1);
    if (!r.ok || !r.secondHandRequest) throw new Error('setup');
    const confirm = await secondHand.confirm(r.secondHandRequest.id, salesHead.id, svc.applyFromSecondHand);
    expect(confirm.ok).toBe(true);
    const rec = await repos.channels.get<Record<number, StagePaymentState>>('tenant', inn, 'stage_paid', {});
    expect(rec.data[1]?.status).toBe('paid');
    expect(rec.data[1]?.confirmedBy).toBe(salesHead.id);
  });

  it('нельзя подтвердить оплату дважды', async () => {
    await seedPending(repos, 68000);
    await svc.confirm(manager, inn, 1);
    const r = await svc.confirm(manager, inn, 1);
    expect(r.ok).toBe(false);
  });

  it('нет счёта на этот этап — понятная ошибка, а не исключение', async () => {
    const r = await svc.confirm(manager, inn, 2);
    expect(r.ok).toBe(false);
  });
});
