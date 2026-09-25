import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import type { StaffMember } from '../shared/channelShapes.js';
import { assignees } from '../shared/assignment.js';

export type StaffResult<T> = { ok: true } & T | { ok: false; error: string };

/**
 * Штатная структура клиники и матрица ответственных по документам
 * (README «Сотрудники и матрица ответственных»). Перенос упрощён относительно
 * прототипа (`reference/prototype/Личный кабинет ВКК.dc.html`): без филиалов,
 * учёта обучения по ИСМП и статуса «уволен» — база (ФИО → должность) уже
 * читают исполнитель и обход, здесь — её первый рабочий источник записи вместо
 * тестового сидирования канала напрямую.
 */
export class StaffService {
  constructor(private repos: Repos) {}

  async list(account: Account): Promise<StaffMember[]> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'staff:list', null, account.inn);
    return (await this.repos.channels.get<StaffMember[]>('tenant', account.inn, 'staff', [])).data;
  }

  async upsert(account: Account, member: StaffMember): Promise<StaffResult<{ staff: StaffMember[] }>> {
    await assertPermission(this.repos.auditLog, account, 'staff:manage', 'staff:upsert', member.fio, account.inn);
    const fio = member.fio.trim();
    if (!fio) return { ok: false, error: 'ФИО обязательно' };
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<StaffMember[]>('tenant', account.inn, 'staff', []);
      const next = rec.data.filter((s) => s.fio.trim() !== fio).concat([{ fio, pos: member.pos.trim() }]);
      const res = await this.repos.channels.set('tenant', account.inn, 'staff', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, staff: next };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async remove(account: Account, fio: string): Promise<StaffResult<{ staff: StaffMember[] }>> {
    await assertPermission(this.repos.auditLog, account, 'staff:manage', 'staff:remove', fio, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<StaffMember[]>('tenant', account.inn, 'staff', []);
      const next = rec.data.filter((s) => s.fio.trim() !== fio.trim());
      const res = await this.repos.channels.set('tenant', account.inn, 'staff', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, staff: next };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async listAssignments(account: Account): Promise<Record<string, string>> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'docasg:list', null, account.inn);
    return (await this.repos.channels.get<Record<string, string>>('tenant', account.inn, 'docasg', {})).data;
  }

  /**
   * Отметки «Выполнено» из кабинета исполнителя, увиденные администрацией клиники
   * (документ → кто из назначенных и когда отметил) — раньше отметка исполнителя
   * не была видна нигде, кроме его собственного кабинета.
   */
  async listDocProgress(account: Account): Promise<Record<string, { fio: string; at: string }[]>> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'docasg:progress', null, account.inn);
    const [asg, accounts] = await Promise.all([
      this.repos.channels.get<Record<string, string>>('tenant', account.inn, 'docasg', {}).then((r) => r.data),
      this.repos.accounts.listByInn(account.inn),
    ]);
    const marks = new Map<string, Record<string, string>>();
    for (const a of accounts) if (a.role === 'nurse') marks.set(a.fio, await this.repos.executorMarks.listForAccount(a.id));
    const out: Record<string, { fio: string; at: string }[]> = {};
    for (const [doc, who] of Object.entries(asg)) {
      const done = assignees(who).flatMap((fio) => {
        const at = marks.get(fio)?.['doc|' + doc];
        return at ? [{ fio, at }] : [];
      });
      if (done.length) out[doc] = done;
    }
    return out;
  }

  /** `who` — ФИО через " + " (несколько исполнителей на один документ), пусто — снять назначение. */
  async setAssignment(account: Account, docName: string, who: string): Promise<StaffResult<{ assignments: Record<string, string> }>> {
    await assertPermission(this.repos.auditLog, account, 'doc:write', 'docasg:set', docName, account.inn);
    const name = docName.trim();
    if (!name) return { ok: false, error: 'Название документа обязательно' };
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, string>>('tenant', account.inn, 'docasg', {});
      const next = { ...rec.data };
      if (who.trim()) next[name] = who.trim();
      else delete next[name];
      const res = await this.repos.channels.set('tenant', account.inn, 'docasg', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, assignments: next };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }
}
