import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { addDays, daysSince, todayString } from '../shared/date.js';
import type { QueueDigestSettings, QueueTaskState, StagePaymentState, SubscriptionState, WalkResultEntry } from '../shared/channelShapes.js';

export type QueueResult<T> = { ok: true } & T | { ok: false; error: string };

export type QueueTaskCategory = 'money' | 'audit';
export type QueueTaskViewState = 'new' | 'in_progress' | 'postponed' | 'closed';

export interface QueueTaskView {
  id: string;
  category: QueueTaskCategory;
  severity: 'критично' | 'важно';
  title: string;
  detail: string;
  tenantInn: string;
  tenantName: string;
  state: QueueTaskViewState;
  stateBy: string | null;
  stateAt: string | null;
}

const OVERDUE_DAYS = 3;
const POSTPONE_DAYS = 3;
const STATE_KEY = 'work_queue_state';
const DIGEST_KEY = 'queue_digest_settings';
const EMPTY_DIGEST: QueueDigestSettings = { recipientEmail: '', schedule: 'каждое утро, 09:00', lastSentAt: null };
const EMPTY_SUBSCRIPTION: SubscriptionState = { tariffKey: null, status: 'none', startedAt: null, expiresAt: null, history: [] };

/**
 * Очередь работы (README «Очередь работы», reference/prototype/Админ-панель.dc.html):
 * «каждая просрочка — задача с состоянием: взял в работу, отложил, закрыл.
 * Состояние общее для всех операторов, поэтому одну клинику не обзвонят
 * дважды. Отложенная задача возвращается в очередь через 3 дня, закрытая —
 * на следующий день, если просрочка так и не исчезла: задача исчезает,
 * только когда исчезает её причина».
 *
 * Задачи НЕ хранятся как сущности — список пересчитывается из реальных
 * данных (`stage_paid`, `subscription`, `walk_results`) при каждом чтении;
 * хранится только состояние работы над КОНКРЕТНОЙ (детерминированно
 * идентифицированной) задачей, поэтому «закрыл» не теряется между заходами,
 * но и не может скрыть проблему навсегда, если она не решена по факту.
 *
 * Право на чтение и действия — `clinic:read` (есть у всех четырёх ролей
 * платформы): очередь общая для всех операторов, а не привязана к одной роли.
 */
export class WorkQueueService {
  constructor(private repos: Repos) {}

  private async getStateMap(): Promise<Record<string, QueueTaskState>> {
    return (await this.repos.channels.get<Record<string, QueueTaskState>>('platform', null, STATE_KEY, {})).data;
  }

  private resolveViewState(taskId: string, stored: Record<string, QueueTaskState>): { state: QueueTaskViewState; by: string | null; at: string | null } {
    const rec = stored[taskId];
    if (!rec) return { state: 'new', by: null, at: null };
    if (rec.state === 'postponed') {
      if (rec.postponedUntil && daysSince(rec.postponedUntil) >= 0) return { state: 'new', by: null, at: null };
      return { state: 'postponed', by: rec.byId, at: rec.at };
    }
    if (rec.state === 'closed') {
      if (daysSince(rec.at) >= 1) return { state: 'new', by: null, at: null };
      return { state: 'closed', by: rec.byId, at: rec.at };
    }
    return { state: rec.state, by: rec.byId, at: rec.at };
  }

  async list(account: Account): Promise<QueueTaskView[]> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'work-queue:list', null, null);
    return this.computeTasks();
  }

  private async computeTasks(): Promise<QueueTaskView[]> {
    const [tenants, stateMap] = await Promise.all([this.repos.tenants.listAll(), this.getStateMap()]);
    const tasks: QueueTaskView[] = [];

    for (const t of tenants) {
      const [stagePaid, subscription, walkResults] = await Promise.all([
        this.repos.channels.get<Record<number, StagePaymentState>>('tenant', t.inn, 'stage_paid', {}),
        this.repos.channels.get<SubscriptionState>('tenant', t.inn, 'subscription', EMPTY_SUBSCRIPTION),
        this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', t.inn, 'walk_results', {}),
      ]);

      for (const [code, p] of Object.entries(stagePaid.data)) {
        if (p.status !== 'pending' || !p.requestedAt || daysSince(p.requestedAt) <= OVERDUE_DAYS) continue;
        const id = `payment-overdue:${t.inn}:${code}`;
        const v = this.resolveViewState(id, stateMap);
        if (v.state === 'closed') continue;
        tasks.push({
          id, category: 'money', severity: 'критично',
          title: 'Оплата не поступила больше 3 дней',
          detail: `Этап ${code} · счёт от ${p.requestedAt} · ${p.amount.toLocaleString('ru-RU')} ₽`,
          tenantInn: t.inn, tenantName: t.name, state: v.state, stateBy: v.by, stateAt: v.at,
        });
      }

      if (subscription.data.status === 'expired') {
        const id = `subscription-expired:${t.inn}`;
        const v = this.resolveViewState(id, stateMap);
        if (v.state !== 'closed') {
          tasks.push({
            id, category: 'money', severity: 'критично',
            title: 'Подписка закончилась без продления',
            detail: subscription.data.expiresAt ? `Истекла ${subscription.data.expiresAt}` : 'Срок истёк',
            tenantInn: t.inn, tenantName: t.name, state: v.state, stateBy: v.by, stateAt: v.at,
          });
        }
      }

      if (Object.keys(walkResults.data).length === 0) {
        const id = `no-audit:${t.inn}`;
        const v = this.resolveViewState(id, stateMap);
        if (v.state !== 'closed') {
          tasks.push({
            id, category: 'audit', severity: 'важно',
            title: 'Клиника без единого обхода',
            detail: 'Ни одного проведённого обхода с момента регистрации',
            tenantInn: t.inn, tenantName: t.name, state: v.state, stateBy: v.by, stateAt: v.at,
          });
        }
      }
    }
    return tasks;
  }

  private async setTaskState(account: Account, taskId: string, patch: Omit<QueueTaskState, 'byId' | 'at'>): Promise<QueueResult<{ state: QueueTaskState }>> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'work-queue:update', taskId, null);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, QueueTaskState>>('platform', null, STATE_KEY, {});
      const state: QueueTaskState = { ...patch, byId: account.id, at: todayString() };
      const next = { ...rec.data, [taskId]: state };
      const res = await this.repos.channels.set('platform', null, STATE_KEY, next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, state };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  take(account: Account, taskId: string): Promise<QueueResult<{ state: QueueTaskState }>> {
    return this.setTaskState(account, taskId, { state: 'in_progress', postponedUntil: null });
  }

  postpone(account: Account, taskId: string): Promise<QueueResult<{ state: QueueTaskState }>> {
    return this.setTaskState(account, taskId, { state: 'postponed', postponedUntil: addDays(todayString(), POSTPONE_DAYS) });
  }

  close(account: Account, taskId: string): Promise<QueueResult<{ state: QueueTaskState }>> {
    return this.setTaskState(account, taskId, { state: 'closed', postponedUntil: null });
  }

  async getDigestSettings(account: Account): Promise<QueueDigestSettings> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'work-queue:digest-settings:read', null, null);
    return (await this.repos.channels.get<QueueDigestSettings>('platform', null, DIGEST_KEY, EMPTY_DIGEST)).data;
  }

  async saveDigestSettings(account: Account, patch: { recipientEmail: string; schedule: string }): Promise<QueueResult<{ settings: QueueDigestSettings }>> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'work-queue:digest-settings:save', null, null);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<QueueDigestSettings>('platform', null, DIGEST_KEY, EMPTY_DIGEST);
      const next: QueueDigestSettings = { ...rec.data, recipientEmail: patch.recipientEmail, schedule: patch.schedule };
      const res = await this.repos.channels.set('platform', null, DIGEST_KEY, next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, settings: next };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  /**
   * Автоматическая отправка по расписанию (scheduler.ts, README «Что дальше» →
   * закрыто) — без Account (вызывает планировщик, не вошедший пользователь) и
   * без повторной отправки в тот же день, даже если тик планировщика чаще суток.
   */
  async runScheduledDigest(): Promise<{ sent: boolean; taskCount: number }> {
    const settings = (await this.repos.channels.get<QueueDigestSettings>('platform', null, DIGEST_KEY, EMPTY_DIGEST)).data;
    if (!settings.recipientEmail.trim() || settings.lastSentAt === todayString()) return { sent: false, taskCount: 0 };
    const tasks = await this.computeTasks();
    const open = tasks.filter((t) => t.state === 'new' || t.state === 'in_progress');
    const body = open.length ? open.map((t) => `· ${t.title} — ${t.tenantName} (${t.detail})`).join('\n') : 'Открытых задач нет.';
    await this.repos.notifier.sendDigest(settings.recipientEmail, `Контур 785 — сводка очереди работы (${open.length})`, body);
    await this.repos.auditLog.append({ actorId: null, actorRole: null, tenantInn: null, action: 'work-queue:digest-auto', target: null, meta: { taskCount: open.length }, allowed: true });
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<QueueDigestSettings>('platform', null, DIGEST_KEY, EMPTY_DIGEST);
      const next: QueueDigestSettings = { ...rec.data, lastSentAt: todayString() };
      const res = await this.repos.channels.set('platform', null, DIGEST_KEY, next, { expectedVersion: rec.version, updatedBy: null });
      if (res.ok) return { sent: true, taskCount: open.length };
    }
    return { sent: true, taskCount: open.length }; // отправлено; отметка не сохранилась — следующий тик отправит снова, не страшно
  }

  /** «Отправить дайджест сейчас» — пишет через `Notifier.sendDigest` (реальная доставка — infra/providers/httpNotifier.ts). */
  async sendDigestNow(account: Account): Promise<QueueResult<{ settings: QueueDigestSettings; taskCount: number }>> {
    const settings = await this.getDigestSettings(account);
    if (!settings.recipientEmail.trim()) return { ok: false, error: 'Укажите получателя сводки' };
    const tasks = await this.list(account);
    const open = tasks.filter((t) => t.state === 'new' || t.state === 'in_progress');
    const body = open.length ? open.map((t) => `· ${t.title} — ${t.tenantName} (${t.detail})`).join('\n') : 'Открытых задач нет.';
    await this.repos.notifier.sendDigest(settings.recipientEmail, `Контур 785 — сводка очереди работы (${open.length})`, body);

    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<QueueDigestSettings>('platform', null, DIGEST_KEY, EMPTY_DIGEST);
      const next: QueueDigestSettings = { ...rec.data, lastSentAt: todayString() };
      const res = await this.repos.channels.set('platform', null, DIGEST_KEY, next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, settings: next, taskCount: open.length };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }
}
