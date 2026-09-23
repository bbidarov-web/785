import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import type { CapaService } from './capaService.js';
import type { ChecklistDef, SelfAuditAnswer, SelfAuditItem, SelfAuditRun } from '../shared/channelShapes.js';

export type SelfAuditResult<T> = { ok: true } & T | { ok: false; error: string };

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Самообследование (README «Кабинет клиники»: «Проверка себя по листам,
 * которыми пользуется надзор... Несоответствия автоматически становятся
 * корректирующими мероприятиями, а результат выгружается одним пакетом для
 * инспектора» — reference/prototype/Личный кабинет ВКК.dc.html, `selfHint`,
 * строка ~8994). В отличие от обещания обхода (см. `WalkService`, оно там не
 * выполнено в прототипе), здесь автоматика реализована по-настоящему: и
 * `finish`, и создание CAPA доступны той же паре ролей (`plan:write` +
 * `capa:write` — clinic_admin и vkk_lead держат оба), так что риска
 * назначить работу чужими руками нет — см. `CapaService.createFromSelfAudit`.
 *
 * Отвечают по трём состояниям: соответствует / не соответствует / не
 * применимо — так в прототипе, в отличие от обхода, где выбор бинарный
 * (в норме / нарушение).
 */
export class SelfAuditService {
  constructor(
    private repos: Repos,
    private capa: CapaService,
  ) {}

  private async catalog(): Promise<ChecklistDef[]> {
    return (await this.repos.channels.get<ChecklistDef[]>('platform', null, 'checklists', [])).data;
  }

  async listRuns(account: Account): Promise<SelfAuditRun[]> {
    await assertPermission(this.repos.auditLog, account, 'plan:read', 'selfaudit:list', null, account.inn);
    const runs = (await this.repos.channels.get<Record<string, SelfAuditRun>>('tenant', account.inn, 'selfaudit', {})).data;
    return Object.values(runs);
  }

  async start(account: Account, checklistName: string): Promise<SelfAuditResult<{ run: SelfAuditRun }>> {
    await assertPermission(this.repos.auditLog, account, 'plan:write', 'selfaudit:start', checklistName, account.inn);
    const checklist = (await this.catalog()).find((c) => c.name === checklistName);
    if (!checklist) return { ok: false, error: 'Чек-лист не найден в каталоге методиста' };

    const run: SelfAuditRun = {
      checklistName,
      items: checklist.items.map((text): SelfAuditItem => ({ text, answer: '', comment: '' })),
      finished: false,
      date: today(),
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, SelfAuditRun>>('tenant', account.inn, 'selfaudit', {});
      const next = { ...rec.data, [checklistName]: run };
      const res = await this.repos.channels.set('tenant', account.inn, 'selfaudit', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, run };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async answer(account: Account, checklistName: string, index: number, answer: SelfAuditAnswer, comment: string): Promise<SelfAuditResult<{ run: SelfAuditRun }>> {
    await assertPermission(this.repos.auditLog, account, 'plan:write', 'selfaudit:answer', checklistName, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, SelfAuditRun>>('tenant', account.inn, 'selfaudit', {});
      const run = rec.data[checklistName];
      if (!run) return { ok: false, error: 'Прогон самообследования не начат' };
      if (run.finished) return { ok: false, error: 'Прогон уже завершён' };
      if (index < 0 || index >= run.items.length) return { ok: false, error: 'Пункт не найден' };
      const items = run.items.slice();
      items[index] = { text: items[index]!.text, answer, comment };
      const updated: SelfAuditRun = { ...run, items };
      const next = { ...rec.data, [checklistName]: updated };
      const res = await this.repos.channels.set('tenant', account.inn, 'selfaudit', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, run: updated };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  /** Завершает прогон и заводит мероприятие по каждому «не соответствует» — идемпотентно (см. CapaService.createFromSelfAudit). */
  async finish(account: Account, checklistName: string): Promise<SelfAuditResult<{ run: SelfAuditRun; capaCreated: number }>> {
    await assertPermission(this.repos.auditLog, account, 'plan:write', 'selfaudit:finish', checklistName, account.inn);
    let finishedRun: SelfAuditRun | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, SelfAuditRun>>('tenant', account.inn, 'selfaudit', {});
      const run = rec.data[checklistName];
      if (!run) return { ok: false, error: 'Прогон самообследования не начат' };
      if (run.items.some((it) => !it.answer)) return { ok: false, error: 'Остались пункты без ответа' };
      const updated: SelfAuditRun = { ...run, finished: true };
      const next = { ...rec.data, [checklistName]: updated };
      const res = await this.repos.channels.set('tenant', account.inn, 'selfaudit', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) {
        finishedRun = updated;
        break;
      }
    }
    if (!finishedRun) return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };

    let capaCreated = 0;
    for (let i = 0; i < finishedRun.items.length; i++) {
      const item = finishedRun.items[i]!;
      if (item.answer !== 'bad') continue;
      const r = await this.capa.createFromSelfAudit(account, checklistName, i, item.text, item.comment);
      if (r.ok) capaCreated++;
    }
    return { ok: true, run: finishedRun, capaCreated };
  }

  /** Выгрузка пакета для инспектора — текстовый сводный документ по всем прогонам (README «Самообследование»). */
  async exportPackage(account: Account): Promise<SelfAuditResult<{ text: string }>> {
    await assertPermission(this.repos.auditLog, account, 'plan:read', 'selfaudit:export', null, account.inn);
    const runs = Object.values((await this.repos.channels.get<Record<string, SelfAuditRun>>('tenant', account.inn, 'selfaudit', {})).data);
    const tenant = await this.repos.tenants.findByInn(account.inn);
    const lines: string[] = [];
    lines.push(`Пакет самообследования — ${tenant?.name ?? account.org ?? `ИНН ${account.inn}`}`);
    lines.push(`ИНН: ${account.inn}`);
    lines.push(`Дата выгрузки: ${today()}`);
    lines.push('');
    for (const run of runs) {
      lines.push(`== ${run.checklistName} ==`);
      lines.push(run.finished ? `Завершено ${run.date}` : 'Не завершено');
      run.items.forEach((it, i) => {
        const label = it.answer === 'ok' ? 'соответствует' : it.answer === 'bad' ? 'НЕ СООТВЕТСТВУЕТ' : it.answer === 'na' ? 'не применимо' : 'без ответа';
        lines.push(`${i + 1}. [${label}] ${it.text}${it.comment ? ' — ' + it.comment : ''}`);
      });
      lines.push('');
    }
    return { ok: true, text: lines.join('\n') };
  }
}
