import type { Repos } from '../domain/ports.js';
import type { Account, SecondHandRequest } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { SecondHandService } from '../secondHand/service.js';
import type { TariffDef } from '../shared/channelShapes.js';

export type TariffResult<T> = { ok: true } & T | { ok: false; error: string };

const CHANNEL_KEY = 'tariffs';

/**
 * Тарифы и продукты (README «Дашборд»: «востребованность тарифов»; SERVER.md
 * §4 — публикация и удаление тарифа входят в семь операций второй руки).
 *
 * Черновик правится напрямую (`tariff:write` — менеджер, руководитель продаж,
 * администратор; методист тарифов не касается — дословно по матрице ROLES).
 * Включение тарифа в продажу (`active: true`) и удаление уже опубликованного —
 * ДВА отдельных запроса второй руки: `tariff:publish` и `tariff:delete`,
 * подтверждает второй сотрудник с `second:money` (руководитель продаж или
 * администратор), не автор запроса (SecondHandService — единое правило).
 */
export class TariffService {
  constructor(
    private repos: Repos,
    private secondHand: SecondHandService,
  ) {}

  async getTariffs(): Promise<TariffDef[]> {
    return (await this.repos.channels.get<TariffDef[]>('platform', null, CHANNEL_KEY, [])).data;
  }

  /**
   * Правит черновик: заводит новые тарифы (только `active:false`) и меняет
   * поля существующих, но НЕ трогает `active` — включение и удаление идут
   * только через запрос второй руки, иначе смысл подтверждения теряется.
   */
  async saveDraft(account: Account, next: TariffDef[]): Promise<TariffResult<{ version: number }>> {
    await assertPermission(this.repos.auditLog, account, 'tariff:write', 'tariff:save-draft', null, null);
    const keys = new Set(next.map((t) => t.key));
    if (keys.size !== next.length) return { ok: false, error: 'Ключи тарифов должны быть уникальны' };

    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<TariffDef[]>('platform', null, CHANNEL_KEY, []);
      const currentByKey = new Map(rec.data.map((t) => [t.key, t]));
      for (const t of next) {
        const current = currentByKey.get(t.key);
        if (current && current.active !== t.active) {
          return { ok: false, error: `«${t.name}» — включение/выключение тарифа только через публикацию или удаление второй рукой` };
        }
        if (!current && t.active) {
          return { ok: false, error: `«${t.name}» — новый тариф можно сохранить только черновиком (не активным)` };
        }
      }
      for (const [key, current] of currentByKey) {
        if (current.active && !keys.has(key)) {
          return { ok: false, error: `«${current.name}» — активный тариф нельзя убрать черновиком, оформите удаление второй рукой` };
        }
      }
      const res = await this.repos.channels.set('platform', null, CHANNEL_KEY, next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, version: res.version };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async requestPublish(account: Account, key: string): Promise<TariffResult<{ secondHandRequest: SecondHandRequest }>> {
    await assertPermission(this.repos.auditLog, account, 'tariff:write', 'tariff:request-publish', key, null);
    const tariffs = await this.getTariffs();
    const tariff = tariffs.find((t) => t.key === key);
    if (!tariff) return { ok: false, error: 'Тариф не найден' };
    if (tariff.active) return { ok: false, error: 'Тариф уже опубликован' };
    const secondHandRequest = await this.secondHand.request('tariff:publish', { key }, null, account.id);
    return { ok: true, secondHandRequest };
  }

  async requestDelete(account: Account, key: string): Promise<TariffResult<{ secondHandRequest: SecondHandRequest }>> {
    await assertPermission(this.repos.auditLog, account, 'tariff:write', 'tariff:request-delete', key, null);
    const tariffs = await this.getTariffs();
    if (!tariffs.some((t) => t.key === key)) return { ok: false, error: 'Тариф не найден' };
    const secondHandRequest = await this.secondHand.request('tariff:delete', { key }, null, account.id);
    return { ok: true, secondHandRequest };
  }

  /** Применяется при подтверждении `tariff:publish` — см. container.ts. */
  applyPublish = async (payload: Record<string, unknown>): Promise<{ tariffs: TariffDef[] }> => {
    const key = String(payload.key);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<TariffDef[]>('platform', null, CHANNEL_KEY, []);
      if (!rec.data.some((t) => t.key === key)) throw new Error('Тариф не найден — возможно, уже удалён');
      const next = rec.data.map((t) => (t.key === key ? { ...t, active: true } : t));
      const res = await this.repos.channels.set('platform', null, CHANNEL_KEY, next, { expectedVersion: rec.version, updatedBy: null });
      if (res.ok) return { tariffs: next };
    }
    throw new Error('Не удалось сохранить — слишком много параллельных правок, повторите');
  };

  /** Применяется при подтверждении `tariff:delete` — см. container.ts. */
  applyDelete = async (payload: Record<string, unknown>): Promise<{ tariffs: TariffDef[] }> => {
    const key = String(payload.key);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<TariffDef[]>('platform', null, CHANNEL_KEY, []);
      const next = rec.data.filter((t) => t.key !== key);
      const res = await this.repos.channels.set('platform', null, CHANNEL_KEY, next, { expectedVersion: rec.version, updatedBy: null });
      if (res.ok) return { tariffs: next };
    }
    throw new Error('Не удалось сохранить — слишком много параллельных правок, повторите');
  };
}
