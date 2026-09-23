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
    apply: (payload: Record<string, unknown>) => Promise<T>,
  ): Promise<SecondHandResult<{ request: SecondHandRequest; result: T }>> {
    const req = await this.repos.secondHand.findById(requestId);
    if (!req) return { ok: false, error: 'Запрос не найден' };
    if (req.status !== 'pending') return { ok: false, error: 'Запрос уже обработан' };
    if (req.expiresAt.getTime() < this.repos.clock.now().getTime()) {
      await this.repos.secondHand.setStatus(requestId, 'expired', null);
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
    const result = await apply(req.payload);
    const confirmed = await this.repos.secondHand.setStatus(requestId, 'confirmed', confirmedById);
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
  }

  async reject(requestId: string, byId: string): Promise<SecondHandResult<{ request: SecondHandRequest }>> {
    const req = await this.repos.secondHand.findById(requestId);
    if (!req) return { ok: false, error: 'Запрос не найден' };
    if (req.status !== 'pending') return { ok: false, error: 'Запрос уже обработан' };
    const updated = await this.repos.secondHand.setStatus(requestId, 'rejected', byId);
    return { ok: true, request: updated };
  }
}
