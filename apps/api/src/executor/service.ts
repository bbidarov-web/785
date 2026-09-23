import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assignees, isMine } from '../shared/assignment.js';
import type {
  AuditPlanItem,
  ClientStateShape,
  EquipmentFill,
  EquipmentPosition,
  ExecutorOverview,
  StaffMember,
  WalkResult,
} from './types.js';

/**
 * Кабинет исполнителя: сотрудник видит ТОЛЬКО то, где клиника назначила его
 * исполнителем — ни по должности, ни «на всякий случай» (README, раздел
 * «Кабинет исполнителя»). Логика — 1:1 перенос `renderVals()` из
 * `reference/prototype/Кабинет исполнителя.dc.html`, источник данных заменён
 * с localStorage на версионированные каналы арендатора.
 */
export class ExecutorService {
  constructor(private repos: Repos) {}

  async getOverview(account: Account): Promise<ExecutorOverview> {
    if (account.role !== 'nurse') {
      throw new Error('Кабинет исполнителя доступен только роли "исполнитель"');
    }
    const inn = account.inn;
    const fio = account.fio;

    const tenant = await this.repos.tenants.findByInn(inn);
    const clinicName = tenant?.name ?? account.org ?? `ИНН ${inn}`;

    const clientState = (await this.repos.channels.get<ClientStateShape>('tenant', inn, 'client_state', {})).data;
    const staff = (await this.repos.channels.get<StaffMember[]>('tenant', inn, 'staff', [])).data;
    const docAsgDirect = (await this.repos.channels.get<Record<string, string>>('tenant', inn, 'docasg', {})).data;

    let position = staff.find((p) => p && p.fio.trim() === fio)?.pos ?? '';
    if (!position) {
      for (const list of Object.values(clientState.staffByBranch ?? {})) {
        const found = list.find((p) => p && p.fio.trim() === fio);
        if (found?.pos) {
          position = found.pos;
          break;
        }
      }
    }

    // рабочее состояние клиники (ещё не опубликованная матрица) + опубликованная матрица;
    // ключи рабочего состояния составные: «этап|блок|номер|название документа»
    const asgFromClientState: Record<string, string> = {};
    for (const [key, who] of Object.entries(clientState.asgMap ?? {})) {
      const parts = key.split('|');
      if (parts.length === 4 && /^\d+$/.test(parts[2] ?? '') && parts[3]) {
        asgFromClientState[parts[3]] = who;
      }
    }
    const docAsg = { ...asgFromClientState, ...docAsgDirect };

    const doneMarks = await this.repos.executorMarks.listForAccount(account.id);

    const docs = Object.entries(docAsg)
      .filter(([, who]) => isMine(who, fio))
      .sort(([a], [b]) => a.localeCompare(b, 'ru'))
      .map(([name, who]) => {
        const doneAt = doneMarks['doc|' + name] ?? null;
        return {
          code: name,
          name,
          where: 'назначение клиники · документ системы качества',
          done: !!doneAt,
          doneAt,
          together: assignees(who).filter((x) => x !== fio),
        };
      });

    const plan = (await this.repos.channels.get<AuditPlanItem[]>('tenant', inn, 'audit_plan', [])).data;
    const results = (await this.repos.channels.get<Record<string, WalkResult>>('tenant', inn, 'walk_results', {})).data;
    const finishedByName = new Set(Object.values(results).filter((r) => r.finished).map((r) => r.name));

    const checks = plan
      .filter((p) => isMine(p.who, fio))
      .map((p) => {
        const name = p.name ?? 'Проверка';
        return {
          name,
          where: [p.object ?? 'объект не указан', p.kind].filter(Boolean).join(' · '),
          done: finishedByName.has(name),
          date: p.date ?? null,
        };
      });

    const equip = (await this.repos.channels.get<EquipmentPosition[]>('tenant', inn, 'equip_pos', [])).data;
    const fills = (await this.repos.channels.get<Record<string, EquipmentFill>>('tenant', inn, 'equip_fill', {})).data;
    const logs = equip.flatMap((p) =>
      Object.entries(p.logWho ?? {})
        .filter(([, who]) => isMine(who, fio))
        .map(([form]) => {
          const fill = fills[p.uid + '|' + form] ?? {};
          return {
            form,
            positionName: [p.name, p.room].filter(Boolean).join(' · '),
            hasEntries: !!fill.date,
            lastDate: fill.date ?? null,
            lastBy: fill.who ?? null,
          };
        }),
    );

    return { fio, position, clinicName, inn, docs, checks, logs };
  }

  async markDocDone(account: Account, code: string): Promise<void> {
    if (account.role !== 'nurse') throw new Error('Доступно только роли "исполнитель"');
    await this.repos.executorMarks.markDone(account.id, 'doc|' + code, code);
  }
}
