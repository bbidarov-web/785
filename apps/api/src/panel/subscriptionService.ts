import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { addDays, daysUntil, todayString } from '../shared/date.js';
import type { StagePaymentState, SubscriptionState, TariffDef } from '../shared/channelShapes.js';

export type SubscriptionResult<T> = { ok: true } & T | { ok: false; error: string };

const EMPTY_STATE: SubscriptionState = { tariffKey: null, status: 'none', startedAt: null, expiresAt: null, history: [] };
const EXPIRING_SOON_DAYS = 14;

export interface SubscriptionRow {
  inn: string;
  name: string;
  tariffKey: string | null;
  tariffName: string | null;
  status: SubscriptionState['status'];
  startedAt: string | null;
  expiresAt: string | null;
}

/** Сводка «Подписки, заказы и продления» (reference/prototype/Админ-панель.dc.html). */
export interface SubscriptionSummary {
  activeCount: number;
  totalContracts: number; // тенанты, у которых подписка когда-либо заводилась (status !== 'none')
  expiringSoonCount: number; // активна/пробный период, истекает в ближайшие 14 дней
  overdueCount: number; // status === 'expired'
  revenueThisCycle: number; // сумма цены тарифа по активным/пробным подпискам за текущий цикл (без пересчёта в месячный эквивалент)
  ordersToPaySum: number; // сумма невыставленных/неоплаченных счетов за этапы (stage_paid со статусом pending)
  ordersToPayCount: number;
}

/**
 * Подписки клиник (README «Дашборд»: «подписки — востребованность тарифов,
 * срок жизни, отток»). Назначает и продлевает менеджер по продажам,
 * руководитель продаж или администратор (`sub:write`) — прямое действие, НЕ
 * входит в семь операций второй руки (SERVER.md §4 перечисляет только
 * публикацию/удаление тарифа, не саму подписку клиники).
 */
export class SubscriptionService {
  constructor(private repos: Repos) {}

  async getState(tenantInn: string): Promise<SubscriptionState> {
    return (await this.repos.channels.get<SubscriptionState>('tenant', tenantInn, 'subscription', EMPTY_STATE)).data;
  }

  async listAll(account: Account): Promise<SubscriptionRow[]> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'subscription:list', null, null);
    const [tenants, tariffs] = await Promise.all([this.repos.tenants.listAll(), this.getTariffs()]);
    const tariffByKey = new Map(tariffs.map((t) => [t.key, t]));
    const rows: SubscriptionRow[] = [];
    for (const t of tenants) {
      const state = await this.getState(t.inn);
      rows.push({
        inn: t.inn,
        name: t.name,
        tariffKey: state.tariffKey,
        tariffName: state.tariffKey ? (tariffByKey.get(state.tariffKey)?.name ?? state.tariffKey) : null,
        status: state.status,
        startedAt: state.startedAt,
        expiresAt: state.expiresAt,
      });
    }
    return rows;
  }

  private async getTariffs(): Promise<TariffDef[]> {
    return (await this.repos.channels.get<TariffDef[]>('platform', null, 'tariffs', [])).data;
  }

  async getSummary(account: Account): Promise<SubscriptionSummary> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'subscription:summary', null, null);
    const [tenants, tariffs] = await Promise.all([this.repos.tenants.listAll(), this.getTariffs()]);
    const tariffByKey = new Map(tariffs.map((t) => [t.key, t]));

    let activeCount = 0;
    let totalContracts = 0;
    let expiringSoonCount = 0;
    let overdueCount = 0;
    let revenueThisCycle = 0;
    let ordersToPaySum = 0;
    let ordersToPayCount = 0;

    for (const t of tenants) {
      const [state, stagePaid] = await Promise.all([
        this.getState(t.inn),
        this.repos.channels.get<Record<number, StagePaymentState>>('tenant', t.inn, 'stage_paid', {}),
      ]);
      if (state.status !== 'none') totalContracts++;
      if (state.status === 'active' || state.status === 'trial') {
        activeCount++;
        const tariff = state.tariffKey ? tariffByKey.get(state.tariffKey) : undefined;
        if (tariff) revenueThisCycle += tariff.price;
        if (state.expiresAt && daysUntil(state.expiresAt) <= EXPIRING_SOON_DAYS) expiringSoonCount++;
      }
      if (state.status === 'expired') overdueCount++;

      for (const p of Object.values(stagePaid.data)) {
        if (p.status === 'pending') {
          ordersToPaySum += p.amount;
          ordersToPayCount++;
        }
      }
    }

    return { activeCount, totalContracts, expiringSoonCount, overdueCount, revenueThisCycle, ordersToPaySum, ordersToPayCount };
  }

  /** Назначает тариф клинике — новая подписка или замена текущей (продление — отдельный метод `renew`). */
  async assign(account: Account, tenantInn: string, tariffKey: string, days: number, trial: boolean): Promise<SubscriptionResult<{ subscription: SubscriptionState }>> {
    await assertPermission(this.repos.auditLog, account, 'sub:write', 'subscription:assign', tariffKey, tenantInn);
    const tariffs = await this.getTariffs();
    const tariff = tariffs.find((t) => t.key === tariffKey);
    if (!tariff || !tariff.active) return { ok: false, error: 'Тариф не найден или не опубликован' };
    if (days <= 0) return { ok: false, error: 'Срок подписки должен быть положительным' };

    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<SubscriptionState>('tenant', tenantInn, 'subscription', EMPTY_STATE);
      const startedAt = todayString();
      const updated: SubscriptionState = {
        tariffKey,
        status: trial ? 'trial' : 'active',
        startedAt,
        expiresAt: addDays(startedAt, days),
        history: rec.data.history.concat([{ at: startedAt, byId: account.id, action: 'assign', tariffKey }]),
      };
      const res = await this.repos.channels.set('tenant', tenantInn, 'subscription', updated, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, subscription: updated };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async renew(account: Account, tenantInn: string, days = 30): Promise<SubscriptionResult<{ subscription: SubscriptionState }>> {
    await assertPermission(this.repos.auditLog, account, 'sub:write', 'subscription:renew', null, tenantInn);
    try {
      const subscription = await this.applyRenew(tenantInn, days, account.id);
      return { ok: true, subscription };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async cancel(account: Account, tenantInn: string): Promise<SubscriptionResult<{ subscription: SubscriptionState }>> {
    await assertPermission(this.repos.auditLog, account, 'sub:write', 'subscription:cancel', null, tenantInn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<SubscriptionState>('tenant', tenantInn, 'subscription', EMPTY_STATE);
      if (rec.data.status === 'none') return { ok: false, error: 'Подписки нет — отменять нечего' };
      const at = todayString();
      const updated: SubscriptionState = { ...rec.data, status: 'cancelled', history: rec.data.history.concat([{ at, byId: account.id, action: 'cancel', tariffKey: rec.data.tariffKey }]) };
      const res = await this.repos.channels.set('tenant', tenantInn, 'subscription', updated, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, subscription: updated };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  /**
   * Продление без проверки прав вызывающего — используется массовой операцией
   * «Продление подписки» (`BulkOperationService`), которая уже проверила
   * право на саму пачку (`sub:write`) при подготовке.
   */
  async applyRenew(tenantInn: string, days: number, byId: string): Promise<SubscriptionState> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<SubscriptionState>('tenant', tenantInn, 'subscription', EMPTY_STATE);
      if (!rec.data.tariffKey || rec.data.status === 'none' || rec.data.status === 'cancelled') {
        throw new Error('нет активной подписки — продлевать нечего');
      }
      const base = rec.data.expiresAt ?? todayString();
      const at = todayString();
      const updated: SubscriptionState = {
        ...rec.data,
        status: rec.data.status === 'expired' ? 'active' : rec.data.status,
        expiresAt: addDays(base, days),
        history: rec.data.history.concat([{ at, byId, action: 'renew', tariffKey: rec.data.tariffKey }]),
      };
      const res = await this.repos.channels.set('tenant', tenantInn, 'subscription', updated, { expectedVersion: rec.version, updatedBy: byId });
      if (res.ok) return updated;
    }
    throw new Error('Не удалось сохранить — слишком много параллельных правок, повторите');
  }
}
