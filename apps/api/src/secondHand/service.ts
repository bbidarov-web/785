import { isSecondHandAction, type SecondHandAction } from '@kontur785/shared';
import type { Repos } from '../domain/ports.js';
import type { SecondHandRequest } from '../domain/types.js';

const REQUEST_TTL_MS = 24 * 60 * 60 * 1000; // сутки на подтверждение

export type SecondHandResult<T> = { ok: true } & T | { ok: false; error: string };

/**
 * «Вторая рука» — семь необратимых операций подтверждает ВТОРОЙ сотрудник,
 * своей же рукой провести нельзя (SERVER.md §4). Реализация: запрос → подтверждение
 * с разными user_id; применение эффекта передаётся вызывающим через `apply`.
 */
export class SecondHandService {
  constructor(private repos: Repos) {}

  async request(type: SecondHandAction, payload: Record<string, unknown>, tenantInn: string | null, requestedById: string): Promise<SecondHandRequest> {
    if (!isSecondHandAction(type)) throw new Error(`Неизвестная операция второй руки: ${type}`);
    return this.repos.secondHand.create({
      type,
      payload,
      tenantInn,
      requestedById,
      expiresAt: new Date(this.repos.clock.now().getTime() + REQUEST_TTL_MS),
    });
  }

  async confirm<T>(
    requestId: string,
    confirmedById: string,
    apply: (payload: Record<string, unknown>, confirmedById: string) => Promise<T>,
  ): Promise<SecondHandResult<{ request: SecondHandRequest; result: T }>> {
    const req = await this.repos.secondHand.findById(requestId);
    if (!req) return { ok: false, error: 'Запрос не найден' };
    if (req.status !== 'pending') return { ok: false, error: 'Запрос уже обработан' };
    if (req.expiresAt.getTime() < this.repos.clock.now().getTime()) {
      await this.repos.secondHand.setStatusIfPending(requestId, 'expired', null);
      return { ok: false, error: 'Срок подтверждения истёк, оформите запрос заново' };
    }
    // своей же рукой провести нельзя — ядро правила
    if (req.requestedById === confirmedById) {
      await this.repos.auditLog.append({
        actorId: confirmedById,
        actorRole: null,
        tenantInn: req.tenantInn,
        action: 'second-hand:self-confirm-rejected',
        target: requestId,
        meta: { type: req.type },
        allowed: false,
      });
      return { ok: false, error: 'Подтвердить может только другой сотрудник, не автор запроса' };
    }
    // Атомарный переход pending → confirmed ДО применения эффекта — защита от
    // гонки: если два запроса подтверждения пришли одновременно, только один
    // получит непустой результат отсюда, второй увидит "уже обработан" вместо
    // того, чтобы оба применили эффект (двойная оплата/продление).
    const confirmed = await this.repos.secondHand.setStatusIfPending(requestId, 'confirmed', confirmedById);
    if (!confirmed) return { ok: false, error: 'Запрос уже обработан' };

    try {
      const result = await apply(req.payload, confirmedById);
      await this.repos.auditLog.append({
        actorId: confirmedById,
        actorRole: null,
        tenantInn: req.tenantInn,
        action: 'second-hand:confirm',
        target: requestId,
        meta: { type: req.type, requestedById: req.requestedById },
        allowed: true,
      });
      return { ok: true, request: confirmed, result };
    } catch (err) {
      // Запрос уже помечен подтверждённым (см. комментарий выше) — эффект не применился,
      // это редкий сбой (после исчерпания внутренних повторов сервиса), а не гонка;
      // фиксируем отдельной строкой в журнале для ручного разбора, а не молчим.
      await this.repos.auditLog.append({
        actorId: confirmedById,
        actorRole: null,
        tenantInn: req.tenantInn,
        action: 'second-hand:confirm-apply-failed',
        target: requestId,
        meta: { type: req.type, error: err instanceof Error ? err.message : String(err) },
        allowed: false,
      });
      throw err;
    }
  }

  /** Нужен обобщённому эндпоинту подтверждения — по типу запроса решить, какое право и какой apply нужны. */
  async get(requestId: string): Promise<SecondHandRequest | null> {
    return this.repos.secondHand.findById(requestId);
  }

  /** Для панели: все открытые запросы второй руки — фильтрацию "могу ли я подтвердить" делает вызывающий по типу. */
  async listPending(): Promise<SecondHandRequest[]> {
    return this.repos.secondHand.listPending();
  }

  async reject(requestId: string, byId: string): Promise<SecondHandResult<{ request: SecondHandRequest }>> {
    const req = await this.repos.secondHand.findById(requestId);
    if (!req) return { ok: false, error: 'Запрос не найден' };
    if (req.status !== 'pending') return { ok: false, error: 'Запрос уже обработан' };
    const updated = await this.repos.secondHand.setStatusIfPending(requestId, 'rejected', byId);
    if (!updated) return { ok: false, error: 'Запрос уже обработан' };
    return { ok: true, request: updated };
  }
}
