import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { parseDate } from '../shared/date.js';
import type { CapaItem, StaffMember, StagePaymentState, SubscriptionState, TariffDef } from '../shared/channelShapes.js';

export interface ClientRow {
  inn: string;
  name: string;
  createdAt: string;
  staffCount: number;
  stagesPaid: number;
  openCapa: number;
}

const EMPTY_SUBSCRIPTION: SubscriptionState = { tariffKey: null, status: 'none', startedAt: null, expiresAt: null, history: [] };

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

/**
 * Каталог клиентов (README «Панель платформы»: «Каталог клиентов: поиск по
 * ИНН... Карточка клиники»). Здесь — только обзорный список с ключевыми
 * счётчиками, без группового выбора и массовых операций (это отдельная,
 * более крупная фича прототипа). Читает `clinic:read` — есть у методиста,
 * менеджера, руководителя продаж и администратора платформы, но не у клиники.
 *
 * Реализация — по одному чтению каналов на клинику (N+1); для десятков
 * клиник это ещё приемлемо, для сотен — нужен отдельный агрегирующий
 * материал вместо чтения `staff`/`stage_paid`/`capa` на лету.
 */
export class DashboardService {
  constructor(private repos: Repos) {}

  async listClients(account: Account): Promise<ClientRow[]> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'dashboard:clients', null, null);
    const tenants = await this.repos.tenants.listAll();
    const rows: ClientRow[] = [];
    for (const t of tenants) {
      const [staff, stagePaid, capa] = await Promise.all([
        this.repos.channels.get<StaffMember[]>('tenant', t.inn, 'staff', []),
        this.repos.channels.get<Record<number, StagePaymentState>>('tenant', t.inn, 'stage_paid', {}),
        this.repos.channels.get<CapaItem[]>('tenant', t.inn, 'capa', []),
      ]);
      rows.push({
        inn: t.inn,
        name: t.name,
        createdAt: t.createdAt.toISOString().slice(0, 10),
        staffCount: staff.data.length,
        stagesPaid: Object.values(stagePaid.data).filter((p) => p.status === 'paid').length,
        openCapa: capa.data.filter((c) => c.status === 'planned').length,
      });
    }
    return rows;
  }

  /**
   * Финансовый дашборд — читает `money:read` (есть у всех четырёх ролей
   * платформы, включая методиста: он видит деньги, но не подтверждает их —
   * `money:write` у него нет, дословно по матрице ROLES).
   */
  async getFinancials(account: Account): Promise<FinancialSummary> {
    await assertPermission(this.repos.auditLog, account, 'money:read', 'dashboard:financials', null, null);
    const tenants = await this.repos.tenants.listAll();
    const tariffs = (await this.repos.channels.get<TariffDef[]>('platform', null, 'tariffs', [])).data;
    const tariffByKey = new Map(tariffs.map((t) => [t.key, t]));

    let mrr = 0;
    let activeCount = 0;
    let everSubscribed = 0;
    let churnedCount = 0;
    const demand = new Map<string, number>();
    const rolloutDurations: number[] = [];

    for (const t of tenants) {
      const sub = (await this.repos.channels.get<SubscriptionState>('tenant', t.inn, 'subscription', EMPTY_SUBSCRIPTION)).data;
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

      const stagePaid = (await this.repos.channels.get<Record<number, StagePaymentState>>('tenant', t.inn, 'stage_paid', {})).data;
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
