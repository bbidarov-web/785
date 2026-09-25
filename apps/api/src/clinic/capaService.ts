import { randomUUID } from 'node:crypto';
import { can } from '@kontur785/shared';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission, PermissionDeniedError } from '../rbac/service.js';
import type { CapaItem, CycleMaster, WalkResultEntry } from '../shared/channelShapes.js';
import { addDays, normalizeDateInput } from '../shared/date.js';
import { assignees, isMine } from '../shared/assignment.js';

export type CapaResult<T> = { ok: true } & T | { ok: false; error: string };

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Нарушения и корректирующие мероприятия (README, раздел «Нарушения и CAPA»).
 * Перенос `planCapaFor()` из reference/prototype/Личный кабинет ВКК.dc.html
 * (строки ~3771–3793): мероприятие ВСЕГДА заводится по конкретному пункту
 * конкретного обхода — свободного создания «с нуля» в прототипе нет. Заводить
 * может ответственный за ВКК или админ клиники (`capa:write`); аудитор и
 * исполнитель фиксируют нарушение обходом, но не назначают работу другим —
 * это дословный комментарий прототипа, не моё предположение.
 *
 * Автоматического создания CAPA при завершении обхода в прототипе НЕТ, хотя
 * текст экрана обхода это обещает («система создаст... план CAPA») — на деле
 * это обещание выполняет клиника, открывая находки и планируя мероприятие
 * вручную. Сохраняю это как есть, а не додумываю недостающую автоматику.
 */
export class CapaService {
  constructor(private repos: Repos) {}

  async list(account: Account): Promise<CapaItem[]> {
    await assertPermission(this.repos.auditLog, account, 'journal:read', 'capa:list', null, account.inn);
    return (await this.repos.channels.get<CapaItem[]>('tenant', account.inn, 'capa', [])).data;
  }

  /** Находки, ещё не превращённые в мероприятие — то, что клинике предстоит разобрать. */
  async listOpenFindings(account: Account): Promise<{ planId: string; itemIndex: number; auditName: string; object: string; text: string; comment: string }[]> {
    await assertPermission(this.repos.auditLog, account, 'journal:read', 'capa:findings', null, account.inn);
    const [resultsRec, capaRec] = await Promise.all([
      this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', account.inn, 'walk_results', {}),
      this.repos.channels.get<CapaItem[]>('tenant', account.inn, 'capa', []),
    ]);
    const converted = new Set(capaRec.data.filter((c) => c.sourceKind === 'walk').map((c) => `${c.sourcePlanId}|${c.sourceItemIndex}`));
    const out: { planId: string; itemIndex: number; auditName: string; object: string; text: string; comment: string }[] = [];
    for (const entry of Object.values(resultsRec.data)) {
      if (!entry.finished) continue;
      entry.items.forEach((item, i) => {
        if (item.answer !== 'bad') return;
        if (converted.has(`${entry.planId}|${i}`)) return;
        out.push({ planId: entry.planId, itemIndex: i, auditName: entry.name, object: entry.object, text: item.text, comment: item.comment });
      });
    }
    return out;
  }

  /**
   * Срок устранения по степени критичности (README «Нарушения и CAPA»,
   * каталог методиста `CycleMaster.capaTerms`). Степень необязательна — без
   * неё срок задаётся вручную, как раньше; если степень указана, но не
   * найдена в текущем опубликованном каталоге, это ошибка, а не молчаливый
   * произвольный срок (CLAUDE.md: не подставлять правдоподобное вместо
   * честного отказа).
   */
  private async resolveDue(opts: { due?: string; severity?: string }): Promise<CapaResult<{ due: string }>> {
    if (!opts.severity) {
      const due = normalizeDateInput(opts.due);
      return due === null ? { ok: false, error: 'Срок не распознан — нужен формат ДД.ММ.ГГГГ' } : { ok: true, due };
    }
    const master = (await this.repos.channels.get<CycleMaster | null>('platform', null, 'cycle_master', null)).data;
    const term = master?.capaTerms.find((t) => t.level === opts.severity);
    if (!term) return { ok: false, error: 'Неизвестная степень критичности — уточните каталог у методиста' };
    return { ok: true, due: addDays(today(), term.days) };
  }

  async createFromFinding(account: Account, planId: string, itemIndex: number, opts: { due?: string; who?: string; severity?: string }): Promise<CapaResult<{ item: CapaItem }>> {
    await assertPermission(this.repos.auditLog, account, 'capa:write', 'capa:create', planId, account.inn);
    const resultsRec = await this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', account.inn, 'walk_results', {});
    const entry = resultsRec.data[planId];
    if (!entry) return { ok: false, error: 'Проверка не найдена' };
    const found = entry.items[itemIndex];
    if (!found) return { ok: false, error: 'Пункт проверки не найден' };
    if (found.answer !== 'bad') return { ok: false, error: 'Мероприятие заводится только по нарушению' };
    const dueResult = await this.resolveDue(opts);
    if (!dueResult.ok) return dueResult;

    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<CapaItem[]>('tenant', account.inn, 'capa', []);
      if (rec.data.some((c) => c.sourcePlanId === planId && c.sourceItemIndex === itemIndex)) {
        return { ok: false, error: 'Мероприятие по этому нарушению уже заведено' };
      }
      const item: CapaItem = {
        id: randomUUID(),
        sourceKind: 'walk',
        sourcePlanId: planId,
        sourceItemIndex: itemIndex,
        auditName: entry.name,
        object: entry.object,
        findingText: found.text,
        comment: found.comment,
        // в результате обхода «who» хранится как «ФИО · должность» (formatOwner) — в мероприятие
        // берём чистые ФИО, иначе исполнитель не совпадёт с account.fio и не сможет его закрыть (capa:own)
        who: opts.who?.trim() || assignees(entry.who).join(' + ') || 'не назначен',
        due: dueResult.due,
        severity: opts.severity ?? null,
        status: 'planned',
        createdAt: today(),
        createdBy: account.id,
        closedAt: null,
        effectiveness: 'not_checked',
        effectivenessComment: '',
        effectivenessAt: null,
      };
      const next = rec.data.concat([item]);
      const res = await this.repos.channels.set('tenant', account.inn, 'capa', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, item };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  /**
   * Самообследование клиника проводит сама, тем же сотрудником, который уже
   * держит `capa:write` (`clinic_admin`/`vkk_lead`) — в отличие от обхода, где
   * аудитор фиксирует чужим руками, здесь privilege-эскалации нет: кто вправе
   * завершить самообследование, вправе и завести по нему мероприятие. Право
   * проверяется здесь заново (а не наследуется от вызывающего), а не потому,
   * что вызывающий мог ошибиться — так каждый метод остаётся самодостаточным.
   */
  async createFromSelfAudit(account: Account, checklistName: string, itemIndex: number, text: string, comment: string): Promise<CapaResult<{ item: CapaItem }>> {
    await assertPermission(this.repos.auditLog, account, 'capa:write', 'capa:create-from-selfaudit', checklistName, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<CapaItem[]>('tenant', account.inn, 'capa', []);
      if (rec.data.some((c) => c.sourceKind === 'selfaudit' && c.sourcePlanId === checklistName && c.sourceItemIndex === itemIndex)) {
        return { ok: false, error: 'Мероприятие по этому несоответствию уже заведено' };
      }
      const item: CapaItem = {
        id: randomUUID(),
        sourceKind: 'selfaudit',
        sourcePlanId: checklistName,
        sourceItemIndex: itemIndex,
        auditName: `Самообследование · ${checklistName}`,
        object: '',
        findingText: text,
        comment,
        who: 'не назначен',
        due: '',
        severity: null,
        status: 'planned',
        createdAt: today(),
        createdBy: account.id,
        closedAt: null,
        effectiveness: 'not_checked',
        effectivenessComment: '',
        effectivenessAt: null,
      };
      const next = rec.data.concat([item]);
      const res = await this.repos.channels.set('tenant', account.inn, 'capa', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, item };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  /**
   * clinic_admin/vkk_lead меняют что угодно (capa:write); исполнитель/аудитор
   * (capa:own) — только статус СВОЕГО мероприятия на "выполнено": он устраняет
   * нарушение, но не переназначает и не снимает чужую задачу.
   */
  async updateStatus(account: Account, id: string, status: 'planned' | 'done'): Promise<CapaResult<{ item: CapaItem }>> {
    const canFull = can(account.role, 'capa:write');
    const canOwn = can(account.role, 'capa:own');
    if (!canFull && !canOwn) {
      await assertPermission(this.repos.auditLog, account, 'capa:write', 'capa:update-status', id, account.inn); // бросит и запишет отказ
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<CapaItem[]>('tenant', account.inn, 'capa', []);
      const idx = rec.data.findIndex((c) => c.id === id);
      if (idx === -1) return { ok: false, error: 'Мероприятие не найдено' };
      const current = rec.data[idx]!;
      if (!canFull && canOwn && !isMine(current.who, account.fio)) {
        throw new PermissionDeniedError('capa:own');
      }
      if (!canFull && status !== 'done') {
        // capa:own меняет только на "выполнено" — снять с себя задачу или отменить её не может
        throw new PermissionDeniedError('capa:own');
      }
      const updated: CapaItem = { ...current, status, closedAt: status === 'done' ? today() : null };
      const next = rec.data.slice();
      next[idx] = updated;
      const res = await this.repos.channels.set('tenant', account.inn, 'capa', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, item: updated };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  /**
   * Формальная проверка эффективности (README «Нарушения и CAPA») — отдельно
   * от «выполнено»: исполнитель устраняет нарушение, а подтверждает, что оно
   * не повторилось, тот, кто держит `capa:write` (не сам исполнитель — это
   * тот же принцип разделения ролей, что и в аудите: не проверяешь сам себя).
   * Неэффективное мероприятие возвращается в работу, а не просто помечается.
   */
  async checkEffectiveness(account: Account, id: string, effective: boolean, comment: string): Promise<CapaResult<{ item: CapaItem }>> {
    await assertPermission(this.repos.auditLog, account, 'capa:write', 'capa:check-effectiveness', id, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<CapaItem[]>('tenant', account.inn, 'capa', []);
      const idx = rec.data.findIndex((c) => c.id === id);
      if (idx === -1) return { ok: false, error: 'Мероприятие не найдено' };
      const current = rec.data[idx]!;
      if (current.status !== 'done') return { ok: false, error: 'Проверять эффективность можно только у выполненного мероприятия' };
      const updated: CapaItem = effective
        ? { ...current, effectiveness: 'effective', effectivenessComment: comment.trim(), effectivenessAt: today() }
        : { ...current, effectiveness: 'not_effective', effectivenessComment: comment.trim(), effectivenessAt: today(), status: 'planned', closedAt: null };
      const next = rec.data.slice();
      next[idx] = updated;
      const res = await this.repos.channels.set('tenant', account.inn, 'capa', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, item: updated };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }
}
