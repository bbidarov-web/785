import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { daysUntil, formatDate, parseDate, todayString } from '../shared/date.js';
import { DocumentService } from '../documents/service.js';
import type { ManagerAssignmentService } from './managerAssignments.js';
import type { Branch, CapaItem, StaffMember, Stage, StagePaymentState, SubscriptionState, TariffDef, WalkResultEntry } from '../shared/channelShapes.js';

export interface ClientRow {
  inn: string;
  name: string;
  createdAt: string;
  staffCount: number;
  stagesPaid: number;
  openCapa: number;
  branchesCount: number;
  tariffKey: string | null;
  tariffName: string | null;
  subscriptionStatus: SubscriptionState['status'];
  /** Документов выдано / документов в опубликованном каталоге, % — 0, если каталог ещё пуст. */
  readinessPct: number;
  /** Последний вход любого сотрудника клиники (ДД.ММ.ГГГГ) — null, если ни разу не заходили. */
  lastActivityAt: string | null;
  /** Подписка истекла/отменена, либо истекает в ближайшие 14 дней (reference/prototype: «Риск оттока»). */
  churnRisk: boolean;
}

const EMPTY_SUBSCRIPTION: SubscriptionState = { tariffKey: null, status: 'none', startedAt: null, expiresAt: null, history: [] };
const CHURN_RISK_WINDOW_DAYS = 14;

export interface TariffDemandRow {
  tariffKey: string;
  tariffName: string;
  count: number;
}

/** Финансовый и внедренческий срез (README «Дашборд»: «финансы (MRR, ARPA...), подписки..., внедрение (срок внедрения по этапам)»). */
export interface FinancialSummary {
  mrr: number; // сумма месячного эквивалента цены тарифа по активным/пробным подпискам
  arpa: number; // mrr / число активных подписок
  activeSubscriptions: number;
  churnRate: number; // доля отменённых/истёкших среди когда-либо подписанных, 0..1
  tariffDemand: TariffDemandRow[];
  avgRolloutDays: number | null; // среднее число дней от заказа первого этапа до приёмки последнего принятого этапа
}

/** Карточки «Портфель» на дашборде (reference/prototype/Админ-панель.dc.html «Дашборд»). */
export interface PortfolioSummary {
  clinicsCount: number;
  mrr: number;
  avgReadinessPct: number;
  auditsInPeriod: number;
  periodDays: number;
}

/**
 * Каталог клиентов (README «Панель платформы»: «Каталог клиентов: поиск по
 * ИНН... Карточка клиники») и портфельный срез дашборда. Читает `clinic:read`
 * — есть у методиста, менеджера, руководителя продаж и администратора
 * платформы, но не у клиники.
 *
 * Реализация — по одному чтению каналов на клинику (N+1); для десятков
 * клиник это ещё приемлемо, для сотен — нужен отдельный агрегирующий
 * материал вместо чтения каналов на лету.
 */
export class DashboardService {
  constructor(
    private repos: Repos,
    private documents: DocumentService,
    private managerAssignments: ManagerAssignmentService,
  ) {}

  private async getCatalogDocCount(): Promise<number> {
    const stages = (await this.repos.channels.get<Stage[]>('platform', null, 'stage_docs', [])).data;
    return stages.reduce((sum, s) => sum + s.blocks.reduce((bs, b) => bs + b.docs.length, 0), 0);
  }

  private async getTariffByKey(): Promise<Map<string, TariffDef>> {
    const tariffs = (await this.repos.channels.get<TariffDef[]>('platform', null, 'tariffs', [])).data;
    return new Map(tariffs.map((t) => [t.key, t]));
  }

  private isChurnRisk(sub: SubscriptionState): boolean {
    if (sub.status === 'expired' || sub.status === 'cancelled') return true;
    if ((sub.status === 'active' || sub.status === 'trial') && sub.expiresAt) return daysUntil(sub.expiresAt) <= CHURN_RISK_WINDOW_DAYS;
    return false;
  }

  async listClients(account: Account): Promise<ClientRow[]> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'dashboard:clients', null, null);
    const [allTenants, scope, tariffByKey, catalogDocCount] = await Promise.all([
      this.repos.tenants.listAll(),
      this.managerAssignments.visibleInns(account),
      this.getTariffByKey(),
      this.getCatalogDocCount(),
    ]);
    // менеджер с закреплением («ответственный менеджер») видит только свои клиники;
    // без закрепления и для всех остальных ролей — как раньше, весь каталог
    const tenants = scope ? allTenants.filter((t) => scope.includes(t.inn)) : allTenants;
    const rows: ClientRow[] = [];
    for (const t of tenants) {
      const [staff, stagePaid, capa, branches, subscription, grants, accounts] = await Promise.all([
        this.repos.channels.get<StaffMember[]>('tenant', t.inn, 'staff', []),
        this.repos.channels.get<Record<number, StagePaymentState>>('tenant', t.inn, 'stage_paid', {}),
        this.repos.channels.get<CapaItem[]>('tenant', t.inn, 'capa', []),
        this.repos.channels.get<Branch[]>('tenant', t.inn, 'branches', []),
        this.repos.channels.get<SubscriptionState>('tenant', t.inn, 'subscription', EMPTY_SUBSCRIPTION),
        this.documents.listActiveGrants(t.inn),
        this.repos.accounts.listByInn(t.inn),
      ]);
      const lastLogin = accounts.reduce<Date | null>((max, a) => (a.lastLoginAt && (!max || a.lastLoginAt > max) ? a.lastLoginAt : max), null);
      const tariff = subscription.data.tariffKey ? tariffByKey.get(subscription.data.tariffKey) : undefined;
      rows.push({
        inn: t.inn,
        name: t.name,
        createdAt: t.createdAt.toISOString().slice(0, 10),
        staffCount: staff.data.length,
        stagesPaid: Object.values(stagePaid.data).filter((p) => p.status === 'paid').length,
        openCapa: capa.data.filter((c) => c.status === 'planned').length,
        branchesCount: branches.data.length,
        tariffKey: subscription.data.tariffKey,
        tariffName: tariff?.name ?? null,
        subscriptionStatus: subscription.data.status,
        readinessPct: catalogDocCount > 0 ? Math.round((Object.keys(grants).length / catalogDocCount) * 100) : 0,
        lastActivityAt: lastLogin ? formatDate(lastLogin) : null,
        churnRisk: this.isChurnRisk(subscription.data),
      });
    }
    return rows;
  }

  /** CSV для «Выгрузить отчёт» (reference/prototype/Админ-панель.dc.html) — разделитель `;` под RU Excel. */
  async exportClientsCsv(account: Account): Promise<string> {
    const rows = await this.listClients(account);
    const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
    const header = ['ИНН', 'Название', 'Тариф', 'Статус подписки', 'Филиалы', 'Готовность %', 'Последняя активность', 'Сотрудников', 'Оплачено этапов', 'Открытых CAPA'];
    const lines = [header.map(esc).join(';')];
    for (const r of rows) {
      lines.push([r.inn, r.name, r.tariffName ?? '—', r.subscriptionStatus, r.branchesCount, r.readinessPct, r.lastActivityAt ?? '—', r.staffCount, r.stagesPaid, r.openCapa].map(esc).join(';'));
    }
    return lines.join('\r\n');
  }

  /** Карточки «Портфель» — reference/prototype/Админ-панель.dc.html «Дашборд». */
  async getPortfolio(account: Account, periodDays: number): Promise<PortfolioSummary> {
    await assertPermission(this.repos.auditLog, account, 'money:read', 'dashboard:portfolio', null, null);
    const [allTenants, scope, tariffByKey, catalogDocCount] = await Promise.all([
      this.repos.tenants.listAll(),
      this.managerAssignments.visibleInns(account),
      this.getTariffByKey(),
      this.getCatalogDocCount(),
    ]);
    const tenants = scope ? allTenants.filter((t) => scope.includes(t.inn)) : allTenants;
    const cutoff = parseDate(todayString()).getTime() - periodDays * 86_400_000;

    let mrr = 0;
    let readinessSum = 0;
    let auditsInPeriod = 0;
    for (const t of tenants) {
      const [subscription, grants, walkResults] = await Promise.all([
        this.repos.channels.get<SubscriptionState>('tenant', t.inn, 'subscription', EMPTY_SUBSCRIPTION),
        this.documents.listActiveGrants(t.inn),
        this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', t.inn, 'walk_results', {}),
      ]);
      const sub = subscription.data;
      if (sub.status === 'active' || sub.status === 'trial') {
        const tariff = sub.tariffKey ? tariffByKey.get(sub.tariffKey) : undefined;
        if (tariff) mrr += tariff.period === 'annual' ? tariff.price / 12 : tariff.price;
      }
      readinessSum += catalogDocCount > 0 ? (Object.keys(grants).length / catalogDocCount) * 100 : 0;
      // канал результатов обхода — словарь planId → запись (WalkService), а не массив: .filter на нём давал 500 в портфеле
      auditsInPeriod += Object.values(walkResults.data).filter((w) => parseDate(w.date).getTime() >= cutoff).length;
    }

    return {
      clinicsCount: tenants.length,
      mrr: Math.round(mrr),
      avgReadinessPct: tenants.length ? Math.round(readinessSum / tenants.length) : 0,
      auditsInPeriod,
      periodDays,
    };
  }

  /**
   * Финансовый дашборд — читает `money:read` (есть у всех четырёх ролей
   * платформы, включая методиста: он видит деньги, но не подтверждает их —
   * `money:write` у него нет, дословно по матрице ROLES).
   */
  async getFinancials(account: Account): Promise<FinancialSummary> {
    await assertPermission(this.repos.auditLog, account, 'money:read', 'dashboard:financials', null, null);
    const [allTenants, scope] = await Promise.all([this.repos.tenants.listAll(), this.managerAssignments.visibleInns(account)]);
    // закреплённый менеджер видит финансовую сводку по своим клиникам, а не по всей платформе —
    // иначе ограничение каталога клиентов ничего бы не стоило: цифры утекали бы через агрегат
    const tenants = scope ? allTenants.filter((t) => scope.includes(t.inn)) : allTenants;
    const tariffByKey = await this.getTariffByKey();

    let mrr = 0;
    let activeCount = 0;
    let everSubscribed = 0;
    let churnedCount = 0;
    const demand = new Map<string, number>();
    const rolloutDurations: number[] = [];

    for (const t of tenants) {
      // Оба чтения по клинике независимы — запускаем параллельно, а не ждём
      // подписку перед этапами (было бы 2×N последовательных round-trip).
      const [subRec, stagePaidRec] = await Promise.all([
        this.repos.channels.get<SubscriptionState>('tenant', t.inn, 'subscription', EMPTY_SUBSCRIPTION),
        this.repos.channels.get<Record<number, StagePaymentState>>('tenant', t.inn, 'stage_paid', {}),
      ]);
      const sub = subRec.data;
      if (sub.history.length > 0) everSubscribed++;
      if (sub.status === 'active' || sub.status === 'trial') {
        activeCount++;
        const tariff = sub.tariffKey ? tariffByKey.get(sub.tariffKey) : undefined;
        if (tariff) {
          mrr += tariff.period === 'annual' ? tariff.price / 12 : tariff.price;
          demand.set(tariff.key, (demand.get(tariff.key) ?? 0) + 1);
        }
      }
      if (sub.status === 'expired' || sub.status === 'cancelled') churnedCount++;

      const stagePaid = stagePaidRec.data;
      const entries = Object.values(stagePaid);
      const requested = entries.map((e) => e.requestedAt).filter((s): s is string => !!s).map((s) => parseDate(s).getTime());
      const accepted = entries.map((e) => e.acceptedAt).filter((s): s is string => !!s).map((s) => parseDate(s).getTime());
      if (requested.length && accepted.length) {
        const start = Math.min(...requested);
        const end = Math.max(...accepted);
        if (end >= start) rolloutDurations.push(Math.round((end - start) / 86_400_000));
      }
    }

    const tariffDemand: TariffDemandRow[] = [...demand.entries()]
      .map(([tariffKey, count]) => ({ tariffKey, tariffName: tariffByKey.get(tariffKey)?.name ?? tariffKey, count }))
      .sort((a, b) => b.count - a.count);

    return {
      mrr: Math.round(mrr),
      arpa: activeCount > 0 ? Math.round(mrr / activeCount) : 0,
      activeSubscriptions: activeCount,
      churnRate: everSubscribed > 0 ? churnedCount / everSubscribed : 0,
      tariffDemand,
      avgRolloutDays: rolloutDurations.length ? Math.round(rolloutDurations.reduce((a, b) => a + b, 0) / rolloutDurations.length) : null,
    };
  }
}
