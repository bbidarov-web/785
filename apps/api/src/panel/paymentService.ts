import { SECOND_SUM } from '@kontur785/shared';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { SecondHandService } from '../secondHand/service.js';
import type { SecondHandRequest } from '../domain/types.js';
import type { StagePaymentState } from '../shared/channelShapes.js';

export type PaymentResult<T> = { ok: true } & T | { ok: false; error: string };

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Подтверждение оплаты этапа платформой (SERVER.md §4, §5: «Оплата... по счёту
 * — после подтверждения оператором»). Методист НЕ подтверждает оплату
 * (`money:write` держат менеджер, руководитель продаж и администратор, но не
 * методист — дословно по матрице ROLES). Подтверждение оплаты от `SECOND_SUM`
 * (100 000 ₽) — операция второй руки (`money:confirm`, SERVER.md §4): вместо
 * прямого применения заводится запрос, второй сотрудник подтверждает его
 * через общий `/api/second-hand/:id/confirm`.
 *
 * Упрощение: платформа не хранит список клиник и их счетов «одним экраном» —
 * подтверждающий указывает ИНН клиники явно, тем же способом, каким уже
 * работает выдача документов (`DocumentService`). Список клиник — часть
 * панели «Каталог клиентов», которая не перенесена.
 */
export class PaymentService {
  constructor(
    private repos: Repos,
    private secondHand: SecondHandService,
  ) {}

  private async applyPayment(tenantInn: string, stageCode: number, confirmedBy: string): Promise<StagePaymentState> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<number, StagePaymentState>>('tenant', tenantInn, 'stage_paid', {});
      const current = rec.data[stageCode];
      if (!current || current.status !== 'pending') throw new Error('Счёт не найден или уже обработан');
      const updated: StagePaymentState = { ...current, status: 'paid', confirmedAt: today(), confirmedBy };
      const next = { ...rec.data, [stageCode]: updated };
      const res = await this.repos.channels.set('tenant', tenantInn, 'stage_paid', next, { expectedVersion: rec.version, updatedBy: confirmedBy });
      if (res.ok) return updated;
    }
    throw new Error('Не удалось сохранить — слишком много параллельных правок, повторите');
  }

  async confirm(account: Account, tenantInn: string, stageCode: number): Promise<PaymentResult<{ payment?: StagePaymentState; secondHandRequest?: SecondHandRequest }>> {
    await assertPermission(this.repos.auditLog, account, 'money:write', 'stage-payment:confirm', String(stageCode), tenantInn);
    const rec = await this.repos.channels.get<Record<number, StagePaymentState>>('tenant', tenantInn, 'stage_paid', {});
    const current = rec.data[stageCode];
    if (!current || current.status !== 'pending') return { ok: false, error: 'Счёт не найден или уже обработан' };

    if (current.amount >= SECOND_SUM) {
      const request = await this.secondHand.request('money:confirm', { tenantInn, stageCode, amount: current.amount }, tenantInn, account.id);
      return { ok: true, secondHandRequest: request };
    }
    const payment = await this.applyPayment(tenantInn, stageCode, account.id);
    await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn, action: 'stage-payment:confirm', target: String(stageCode), meta: { amount: current.amount }, allowed: true });
    return { ok: true, payment };
  }

  /** Применяется генератором второй руки при подтверждении `money:confirm` — см. container.ts. */
  applyFromSecondHand = async (payload: Record<string, unknown>, confirmedBy: string): Promise<StagePaymentState> => {
    return this.applyPayment(String(payload.tenantInn), Number(payload.stageCode), confirmedBy);
  };
}
