import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import type { CapaItem, StaffMember, StagePaymentState } from '../shared/channelShapes.js';

export interface ClientRow {
  inn: string;
  name: string;
  createdAt: string;
  staffCount: number;
  stagesPaid: number;
  openCapa: number;
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
}
