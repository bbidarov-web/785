import { normInn } from '@kontur785/shared';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission, PermissionDeniedError } from '../rbac/service.js';

export type AssignResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const CHANNEL_KEY = 'manager_assignments';

/** accountId менеджера → список ИНН клиник, закреплённых за ним. */
type AssignmentMap = Record<string, string[]>;

export interface AssignmentView {
  managerId: string;
  managerFio: string;
  clinics: { inn: string; name: string }[];
}

/**
 * «Ответственный менеджер» (README «Известные ограничения» / `SERVER.md` §4) — по умолчанию
 * `sales_manager` видит и выдаёт документы по всем клиникам платформы: это раньше не различало
 * «своих» и «чужих». Здесь — точечное закрепление: администратор платформы назначает менеджеру
 * список ИНН, и для НЕГО (не для `sales_head`/`platform_admin`/`methodist` — они остаются
 * супервизорами со полным обзором) каталог клиентов (`DashboardService.listClients`) и выдача
 * документов (`POST /api/documents/grant|revoke`) сужаются до назначенных клиник.
 *
 * Сознательно НЕ включено по умолчанию: пока у менеджера нет ни одной записи в этом канале,
 * поведение прежнее (видит всех) — иначе внедрение этой правки мгновенно ослепило бы всех
 * менеджеров, которых администратор ещё не успел разнести по клиникам. Закрепление — это
 * действие администратора, а не автоматическая миграция существующих данных.
 */
export class ManagerAssignmentService {
  constructor(private repos: Repos) {}

  private async load(): Promise<{ data: AssignmentMap; version: number }> {
    return this.repos.channels.get<AssignmentMap>('platform', null, CHANNEL_KEY, {});
  }

  async list(account: Account): Promise<AssignmentView[]> {
    await assertPermission(this.repos.auditLog, account, 'role:manage', 'manager-assignment:list', null, null);
    const [map, managers] = await Promise.all([this.load(), this.repos.accounts.listBySide('platform')]);
    const out: AssignmentView[] = [];
    for (const m of managers) {
      if (m.role !== 'sales_manager') continue;
      const inns = map.data[m.id] ?? [];
      const clinics = await Promise.all(inns.map(async (inn) => ({ inn, name: (await this.repos.tenants.findByInn(inn))?.name ?? `ИНН ${inn}` })));
      out.push({ managerId: m.id, managerFio: m.fio, clinics });
    }
    return out;
  }

  async setForManager(account: Account, managerId: string, innsRaw: string[]): Promise<AssignResult<{ clinics: { inn: string; name: string }[] }>> {
    await assertPermission(this.repos.auditLog, account, 'role:manage', 'manager-assignment:set', managerId, null);
    const manager = await this.repos.accounts.findById(managerId);
    if (!manager || manager.side !== 'platform' || manager.role !== 'sales_manager') {
      return { ok: false, error: 'Закрепление доступно только для менеджера по продажам' };
    }
    const inns = [...new Set(innsRaw.map((i) => normInn(i)).filter(Boolean))];
    for (const inn of inns) {
      if (!(await this.repos.tenants.findByInn(inn))) return { ok: false, error: `Клиника с ИНН ${inn} не найдена` };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.load();
      const next: AssignmentMap = { ...rec.data };
      if (inns.length) next[managerId] = inns;
      else delete next[managerId]; // пустой список — снять ограничение целиком, а не запереть на нуле клиник
      const res = await this.repos.channels.set('platform', null, CHANNEL_KEY, next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) {
        await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn: null, action: 'manager-assignment:set', target: managerId, meta: { inns }, allowed: true });
        const clinics = await Promise.all(inns.map(async (inn) => ({ inn, name: (await this.repos.tenants.findByInn(inn))?.name ?? `ИНН ${inn}` })));
        return { ok: true, clinics };
      }
    }
    return { ok: false, error: 'Не удалось сохранить — повторите' };
  }

  /** Список ИНН, видимых аккаунту: null — ограничений нет (супервизор или менеджер без закрепления). */
  async visibleInns(account: Account): Promise<string[] | null> {
    if (account.role !== 'sales_manager') return null;
    const inns = (await this.load()).data[account.id];
    return inns && inns.length ? inns : null;
  }

  /** Бросает `PermissionDeniedError`, если у аккаунта есть закрепление и клиника в него не входит. */
  async assertTenantVisible(account: Account, tenantInn: string): Promise<void> {
    const scope = await this.visibleInns(account);
    if (scope && !scope.includes(normInn(tenantInn))) {
      await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn, action: 'manager-assignment:denied', target: tenantInn, meta: null, allowed: false });
      throw new PermissionDeniedError('manager-assignment:scope');
    }
  }
}
