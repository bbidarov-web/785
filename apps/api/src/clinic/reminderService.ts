import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assignees } from '../shared/assignment.js';
import type { AuditPlanItem, CapaItem, WalkResultEntry } from '../shared/channelShapes.js';
import { daysSince, daysUntil } from '../shared/date.js';

const SENT_KEY = 'reminders_sent';
const MAX_SENT = 1000;

/**
 * Напоминания и эскалация по срокам (handoff-план, Н4): проверка плана или
 * мероприятие CAPA →
 *  · за 3 дня до срока — исполнителю;
 *  · в день срока — исполнителю и руководству клиники (админ клиники, ответственный за ВКК);
 *  · после срока (1-й, 3-й, 7-й день просрочки) — руководству клиники.
 * Получатель находится по ФИО среди учётных записей клиники (назначения хранятся
 * именами) — если у человека нет ни почты, ни телефона, напомнить нечем и это
 * молча пропускается. Повтор исключён: отправленные вехи запоминаются в канале
 * клиники, поэтому частый тик планировщика безопасен.
 */
export class ReminderService {
  constructor(private repos: Repos) {}

  private contactOf(a: Account): { via: 'sms' | 'email'; to: string } | null {
    if (a.email) return { via: 'email', to: a.email };
    if (a.phone) return { via: 'sms', to: a.phone };
    return null;
  }

  private milestoneFor(dueDate: string): { kind: 'd3' | 'd0' | 'late'; step: number } | null {
    const until = daysUntil(dueDate);
    if (until === 3) return { kind: 'd3', step: 3 };
    if (until === 0) return { kind: 'd0', step: 0 };
    const late = daysSince(dueDate);
    if ([1, 3, 7].includes(late)) return { kind: 'late', step: late };
    return null;
  }

  /** Один проход по всем клиникам; возвращает число отправленных напоминаний. */
  async run(): Promise<number> {
    const tenants = await this.repos.tenants.listAll();
    let sent = 0;
    for (const t of tenants) sent += await this.runForTenant(t.inn, t.name);
    return sent;
  }

  private async runForTenant(inn: string, clinicName: string): Promise<number> {
    const [planRec, capaRec, resultsRec, sentRec, accounts] = await Promise.all([
      this.repos.channels.get<AuditPlanItem[]>('tenant', inn, 'audit_plan', []),
      this.repos.channels.get<CapaItem[]>('tenant', inn, 'capa', []),
      this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', inn, 'walk_results', {}),
      this.repos.channels.get<string[]>('tenant', inn, SENT_KEY, []),
      this.repos.accounts.listByInn(inn),
    ]);
    const active = accounts.filter((a) => !a.pending && !a.blocked);
    const managers = active.filter((a) => a.role === 'clinic_admin' || a.role === 'vkk_lead');
    const already = new Set(sentRec.data);
    const newlySent: string[] = [];
    let count = 0;

    const notify = async (key: string, recipients: Account[], subject: string, text: string) => {
      if (already.has(key)) return;
      already.add(key);
      newlySent.push(key);
      for (const r of recipients) {
        const c = this.contactOf(r);
        if (!c) continue;
        await this.repos.notifier.sendReminder(c.via, c.to, subject, text);
        count++;
      }
    };
    const byFio = (who: string) => active.filter((a) => assignees(who).includes(a.fio));

    for (const p of planRec.data) {
      if (!p.date || resultsRec.data[p.id]?.finished) continue;
      const m = this.milestoneFor(p.date);
      if (!m) continue;
      const what = `проверка «${p.name || p.dir || 'без названия'}» (${clinicName}), срок ${p.date}`;
      const key = `plan:${p.id}:${m.kind}${m.step}:${p.date}`;
      if (m.kind === 'd3') await notify(key, byFio(p.who ?? ''), 'Срок проверки через 3 дня', what);
      else if (m.kind === 'd0') await notify(key, [...byFio(p.who ?? ''), ...managers], 'Сегодня срок проверки', what);
      else await notify(key, managers, `Проверка просрочена на ${m.step} дн.`, what);
    }
    for (const c of capaRec.data) {
      if (c.status !== 'planned' || !c.due) continue;
      const m = this.milestoneFor(c.due);
      if (!m) continue;
      const what = `мероприятие по нарушению «${c.findingText}» (${clinicName}), срок ${c.due}, ответственный: ${c.who}`;
      const key = `capa:${c.id}:${m.kind}${m.step}:${c.due}`;
      if (m.kind === 'd3') await notify(key, byFio(c.who), 'Срок мероприятия через 3 дня', what);
      else if (m.kind === 'd0') await notify(key, [...byFio(c.who), ...managers], 'Сегодня срок мероприятия', what);
      else await notify(key, managers, `Мероприятие просрочено на ${m.step} дн.`, what);
    }

    if (newlySent.length) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const rec = await this.repos.channels.get<string[]>('tenant', inn, SENT_KEY, []);
        const next = [...rec.data, ...newlySent].slice(-MAX_SENT);
        const res = await this.repos.channels.set('tenant', inn, SENT_KEY, next, { expectedVersion: rec.version, updatedBy: null });
        if (res.ok) break;
      }
    }
    return count;
  }
}
