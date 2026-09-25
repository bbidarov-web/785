import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { DocumentService } from '../documents/service.js';
import { isBeforeToday } from '../shared/date.js';
import type { AuditPlanItem, CapaItem, ClinicProfile, StaffMember, Stage, WalkResultEntry } from '../shared/channelShapes.js';

export interface ReadinessLine {
  key: string;
  label: string;
  weight: number;
  earned: number;
  /** Почему баллов не хватает — конкретной строкой; пусто, если пункт выполнен полностью. */
  reason: string;
}

export interface Readiness {
  percent: number;
  lines: ReadinessLine[];
}

/**
 * Готовность клиники к проверке (handoff-план, ценность №2: «не "у нас вроде всё
 * есть", а число с раскладкой»). Каждый недостающий процент объясняется строкой
 * с причиной и числом — из реальных данных клиники, ничего не выдумано; пока
 * каталог методиста пуст, документы просто не участвуют в оценке (не подменяем
 * пустое правдоподобным нулём или 100%).
 */
export class ReadinessService {
  private documents: DocumentService;

  constructor(private repos: Repos) {
    this.documents = new DocumentService(repos);
  }

  async get(account: Account): Promise<Readiness> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'readiness:view', null, account.inn);
    const inn = account.inn;
    const [catalog, grants, profile, staff, plan, results, capa] = await Promise.all([
      this.repos.channels.get<Stage[]>('platform', null, 'stage_docs', []).then((r) => r.data),
      this.documents.listActiveGrants(inn),
      this.repos.channels.get<ClinicProfile | null>('tenant', inn, 'profile', null).then((r) => r.data),
      this.repos.channels.get<StaffMember[]>('tenant', inn, 'staff', []).then((r) => r.data),
      this.repos.channels.get<AuditPlanItem[]>('tenant', inn, 'audit_plan', []).then((r) => r.data),
      this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', inn, 'walk_results', {}).then((r) => r.data),
      this.repos.channels.get<CapaItem[]>('tenant', inn, 'capa', []).then((r) => r.data),
    ]);

    const lines: ReadinessLine[] = [];
    const add = (key: string, label: string, weight: number, ratio: number, reason: string) =>
      lines.push({ key, label, weight, earned: Math.round(weight * Math.max(0, Math.min(1, ratio)) * 10) / 10, reason: ratio >= 1 ? '' : reason });

    const fields: [keyof ClinicProfile, string][] = [['orgFull', 'полное наименование'], ['license', 'номер лицензии'], ['chiefDoctor', 'руководитель'], ['city', 'город']];
    const missingFields = fields.filter(([k]) => !profile?.[k]?.trim()).map(([, name]) => name);
    add('profile', 'Реквизиты клиники', 10, (fields.length - missingFields.length) / fields.length, `не заполнено: ${missingFields.join(', ')}`);

    add('staff', 'Штат клиники', 5, staff.length ? 1 : 0, 'сотрудники не добавлены');

    const docs = catalog.flatMap((s) => s.blocks.flatMap((b) => b.docs.map((d) => d.name)));
    if (docs.length) {
      const missing = docs.filter((n) => !grants[n]);
      add('docs', 'Документы системы качества выданы', 35, (docs.length - missing.length) / docs.length,
        `не выдано ${missing.length} из ${docs.length}: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
    }

    add('plan', 'План проверок составлен', 10, plan.length ? 1 : 0, 'в плане нет ни одной проверки');

    const overduePlan = plan.filter((p) => p.date && !results[p.id]?.finished && isBeforeToday(p.date));
    add('plan-overdue', 'Проверки проведены в срок', 15, overduePlan.length ? 0 : 1,
      `просрочено проверок: ${overduePlan.length} (${overduePlan.slice(0, 2).map((p) => p.name || p.dir).join(', ')})`);

    add('walks', 'Проведён хотя бы один обход', 10, Object.values(results).some((r) => r.finished) ? 1 : 0, 'ни одного завершённого обхода');

    const seen = new Set(capa.filter((c) => c.sourceKind === 'walk').map((c) => `${c.sourcePlanId}|${c.sourceItemIndex}`));
    const unconverted = Object.values(results).flatMap((e) => (e.finished ? e.items.map((it, i) => ({ it, key: `${e.planId}|${i}` })) : []))
      .filter(({ it, key }) => it.answer === 'bad' && !seen.has(key)).length;
    add('findings', 'Нарушения разобраны (по каждому есть мероприятие)', 10, unconverted ? 0 : 1, `нарушений без мероприятия: ${unconverted}`);

    const overdueCapa = capa.filter((c) => c.status === 'planned' && c.due && isBeforeToday(c.due));
    add('capa-overdue', 'Мероприятия выполнены в срок', 5, overdueCapa.length ? 0 : 1, `просрочено мероприятий: ${overdueCapa.length}`);

    const total = lines.reduce((s, l) => s + l.weight, 0);
    const earned = lines.reduce((s, l) => s + l.earned, 0);
    return { percent: total ? Math.round((earned / total) * 100) : 0, lines };
  }
}
