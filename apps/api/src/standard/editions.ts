import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { todayString } from '../shared/date.js';

/**
 * Контур редакций стандарта (handoff-план, плоскости «стандарт» и «внедрение»).
 * Каждый каталог методиста (этапы, чек-листы, годовой цикл, типы оборудования,
 * сводный отчёт) версионируется САМ по себе: публикация выпускает новую
 * НЕИЗМЕНЯЕМУЮ редакцию (`standard_edition_data:<каталог>:<N>` пишется один раз),
 * а клиника работает по принятой ею редакции и видит новую как рекомендацию —
 * принять или оставить прежнюю. Живой канал `platform/<каталог>` по-прежнему
 * хранит последнюю опубликованную версию — им пользуется панель методиста.
 */

export const CATALOGS = {
  stage_docs: 'Каталог этапов и документов',
  checklists: 'Чек-листы',
  cycle_master: 'Годовой цикл',
  equip_types: 'Типы оборудования',
  summary_master: 'Сводный отчёт',
} as const;
export type CatalogKey = keyof typeof CATALOGS;

export function isCatalogKey(v: string): v is CatalogKey {
  return Object.prototype.hasOwnProperty.call(CATALOGS, v);
}

export interface EditionMeta {
  no: number;
  publishedAt: string;
  byId: string | null;
  requestedBy: string | null;
  /** Что изменилось относительно предыдущей редакции — строками для рекомендации клинике. */
  changes: string[];
  /** Пилотный тираж: редакция видна только этим клиникам, пока методист не выпустит её для всех. */
  pilot?: string[];
}

interface AdoptionRecord {
  adopted: number;
  /** Номер редакции, от которой клиника отказалась (остаётся на прежней). */
  declined: number | null;
  at: string;
  byId: string | null;
}
type Adoption = Partial<Record<CatalogKey, AdoptionRecord>>;

export interface Recommendation {
  catalog: CatalogKey;
  label: string;
  adopted: number;
  latest: number;
  status: 'pending' | 'declined';
  changes: string[];
}

export interface AdoptionReportRow {
  catalog: CatalogKey;
  label: string;
  latest: number;
  accepted: number;
  pending: number;
  declined: number;
  tenants: { inn: string; name: string; adopted: number; status: 'current' | 'pending' | 'declined' }[];
  /** Редакция в пилоте (ещё не выпущена для всех): номер и клиники-участники. */
  pilot: { no: number; inns: string[] } | null;
}

const idxKey = (k: CatalogKey) => `standard_edition_index:${k}`;
const dataKey = (k: CatalogKey, no: number) => `standard_edition_data:${k}:${no}`;
const ADOPTION = 'standard_adoption';

type Named = Record<string, unknown>;

function diffLines(key: CatalogKey, prev: unknown, next: unknown): string[] {
  const lines: string[] = [];
  const asArr = (v: unknown): Named[] => (Array.isArray(v) ? (v as Named[]) : []);
  const idOf: Record<CatalogKey, (x: Named) => string> = {
    stage_docs: (x) => String(x.code),
    checklists: (x) => String(x.name),
    cycle_master: (x) => String(x.name),
    equip_types: (x) => String(x.key),
    summary_master: (x) => String(x.name),
  };
  const labelOf = (x: Named) => String(x.name ?? x.key ?? x.code);
  const p = key === 'cycle_master' ? asArr((prev as Named | null)?.dirs) : asArr(prev);
  const n = key === 'cycle_master' ? asArr((next as Named | null)?.dirs) : asArr(next);
  const pm = new Map(p.map((x) => [idOf[key](x), x]));
  const nm = new Map(n.map((x) => [idOf[key](x), x]));
  for (const [id, x] of nm) {
    const old = pm.get(id);
    if (!old) lines.push(`добавлено: ${labelOf(x)}`);
    else if (JSON.stringify(old) !== JSON.stringify(x)) lines.push(`изменено: ${labelOf(x)}`);
  }
  for (const [id, x] of pm) if (!nm.has(id)) lines.push(`удалено: ${labelOf(x)}`);
  if (key === 'stage_docs') {
    const docs = (list: Named[]) => new Set(list.flatMap((s) => asArr(s.blocks).flatMap((b) => asArr(b.docs).map((d) => String(d.name)))));
    const pd = docs(p); const nd = docs(n);
    for (const d of nd) if (!pd.has(d)) lines.push(`новый документ: ${d}`);
    for (const d of pd) if (!nd.has(d)) lines.push(`документ исключён: ${d}`);
  }
  if (key === 'cycle_master') {
    const terms = (v: unknown) => new Map(asArr((v as Named | null)?.capaTerms).map((t) => [String(t.level), Number(t.days)]));
    const pt = terms(prev); const nt = terms(next);
    for (const [lvl, days] of nt) if (pt.get(lvl) !== days) lines.push(`срок CAPA «${lvl}»: ${pt.has(lvl) ? `${pt.get(lvl)} → ` : ''}${days} дн.`);
  }
  return lines.length ? lines : ['без содержательных изменений'];
}

export class StandardEditionService {
  constructor(private repos: Repos) {}

  async index(key: CatalogKey): Promise<EditionMeta[]> {
    return (await this.repos.channels.get<EditionMeta[]>('platform', null, idxKey(key), [])).data;
  }

  private async liveData(key: CatalogKey): Promise<unknown> {
    return (await this.repos.channels.get<unknown>('platform', null, key, null)).data;
  }

  private isEmpty(v: unknown): boolean {
    return v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  }

  async editionData<T>(key: CatalogKey, no: number, fallback: T): Promise<T> {
    return (await this.repos.channels.get<T>('platform', null, dataKey(key, no), fallback)).data;
  }

  private async writeEdition(key: CatalogKey, data: unknown, byId: string | null, requestedBy: string | null, changes: string[], pilot?: string[]): Promise<EditionMeta> {
    let bump = 0; // остаток от оборвавшейся публикации (данные есть, индекса нет) — берём следующий свободный номер
    for (let attempt = 0; attempt < 8; attempt++) {
      const idx = await this.repos.channels.get<EditionMeta[]>('platform', null, idxKey(key), []);
      const no = (idx.data.at(-1)?.no ?? 0) + 1 + bump;
      // данные редакции пишутся ОДИН раз (expectedVersion 0) — так изданная редакция неизменяема
      const d = await this.repos.channels.set('platform', null, dataKey(key, no), JSON.parse(JSON.stringify(data)), { expectedVersion: 0, updatedBy: byId });
      if (!d.ok) { bump++; continue; }
      const meta: EditionMeta = { no, publishedAt: todayString(), byId, requestedBy, changes, ...(pilot?.length ? { pilot } : {}) };
      const res = await this.repos.channels.set('platform', null, idxKey(key), [...idx.data, meta], { expectedVersion: idx.version, updatedBy: byId });
      if (res.ok) return meta;
    }
    throw new Error('Не удалось выпустить редакцию — слишком много параллельных публикаций, повторите');
  }

  /** Выпуск редакции при подтверждении публикации (CatalogService.applyPublish). Возвращает null, если содержимое не изменилось. */
  async publish(key: CatalogKey, data: unknown, byId: string | null, requestedBy: string | null, pilot?: string[]): Promise<EditionMeta | null> {
    let idx = await this.index(key);
    if (idx.length === 0) {
      const live = await this.liveData(key);
      if (!this.isEmpty(live)) {
        // до введения версий у каталога уже была живая версия — фиксируем её как редакцию 1,
        // а действующие клиники остаются на ней, пока сами не примут новую
        const base = await this.writeEdition(key, live, null, null, ['Исходная редакция (до введения версий)']);
        for (const t of await this.repos.tenants.listAll()) await this.setAdoption(t.inn, key, { adopted: base.no, declined: null, at: todayString(), byId: null });
        idx = [base];
      }
    }
    const prevNo = idx.at(-1)?.no;
    const prev = prevNo ? await this.editionData(key, prevNo, null as unknown) : null;
    if (prevNo && JSON.stringify(prev) === JSON.stringify(data)) return null;
    return this.writeEdition(key, data, byId, requestedBy, diffLines(key, prev, data), pilot);
  }

  private async getAdoption(inn: string): Promise<{ data: Adoption; version: number }> {
    const r = await this.repos.channels.get<Adoption>('tenant', inn, ADOPTION, {});
    return { data: r.data, version: r.version };
  }

  private async setAdoption(inn: string, key: CatalogKey, rec: AdoptionRecord): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.getAdoption(inn);
      const res = await this.repos.channels.set('tenant', inn, ADOPTION, { ...cur.data, [key]: rec }, { expectedVersion: cur.version, updatedBy: rec.byId });
      if (res.ok) return;
    }
    throw new Error('Не удалось сохранить принятие редакции — повторите');
  }

  /** Последняя редакция, ДОСТУПНАЯ клинике: общая либо пилотная, в которую она включена. */
  private visibleLatest(idx: EditionMeta[], inn: string): EditionMeta | null {
    for (let i = idx.length - 1; i >= 0; i--) if (!idx[i]!.pilot || idx[i]!.pilot!.includes(inn)) return idx[i]!;
    return null;
  }

  /** Редакция, по которой РАБОТАЕТ клиника: принятая ею; у новой клиники (записи нет) — последняя доступная ей, и она фиксируется. */
  async adoptedNo(inn: string, key: CatalogKey): Promise<number | null> {
    const idx = await this.index(key);
    if (idx.length === 0) return null;
    const rec = (await this.getAdoption(inn)).data[key];
    if (rec && idx.some((e) => e.no === rec.adopted)) return rec.adopted;
    const latest = this.visibleLatest(idx, inn);
    if (!latest) return null;
    await this.setAdoption(inn, key, { adopted: latest.no, declined: null, at: todayString(), byId: null });
    return latest.no;
  }

  /** Каталог для клиники: принятая редакция; пока редакций нет (данные только в живом канале) — живая версия. */
  async catalog<T>(inn: string, key: CatalogKey, fallback: T): Promise<T> {
    const no = await this.adoptedNo(inn, key);
    if (no === null) {
      // редакции есть, но все — пилотные и клиника в них не входит: живой канал уже несёт пилотные данные, отдавать его нельзя
      if ((await this.index(key)).length > 0) return fallback;
      const live = await this.liveData(key);
      return (live === null || live === undefined ? fallback : live) as T;
    }
    return this.editionData<T>(key, no, fallback);
  }

  async recommendations(account: Account): Promise<{ catalogs: { catalog: CatalogKey; label: string; adopted: number | null; latest: number | null }[]; recommendations: Recommendation[] }> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'standard:recommendations', null, account.inn);
    const catalogs: { catalog: CatalogKey; label: string; adopted: number | null; latest: number | null }[] = [];
    const recommendations: Recommendation[] = [];
    for (const key of Object.keys(CATALOGS) as CatalogKey[]) {
      const idx = await this.index(key);
      const adopted = await this.adoptedNo(account.inn, key);
      const latest = this.visibleLatest(idx, account.inn)?.no ?? null;
      catalogs.push({ catalog: key, label: CATALOGS[key], adopted, latest });
      if (adopted === null || latest === null || latest <= adopted) continue;
      const rec = (await this.getAdoption(account.inn)).data[key];
      recommendations.push({
        catalog: key, label: CATALOGS[key], adopted, latest,
        status: rec?.declined === latest ? 'declined' : 'pending',
        changes: idx.filter((e) => e.no > adopted && e.no <= latest && (!e.pilot || e.pilot.includes(account.inn))).flatMap((e) => e.changes.map((c) => `ред. ${e.no}: ${c}`)),
      });
    }
    return { catalogs, recommendations };
  }

  async accept(account: Account, key: CatalogKey): Promise<{ ok: true; adopted: number } | { ok: false; error: string }> {
    await assertPermission(this.repos.auditLog, account, 'adoption:decide', 'standard:accept', key, account.inn);
    const latest = this.visibleLatest(await this.index(key), account.inn)?.no;
    if (!latest) return { ok: false, error: 'Редакций этого каталога ещё нет' };
    await this.setAdoption(account.inn, key, { adopted: latest, declined: null, at: todayString(), byId: account.id });
    await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn: account.inn, action: 'standard:adopted', target: key, meta: { edition: latest }, allowed: true });
    return { ok: true, adopted: latest };
  }

  async decline(account: Account, key: CatalogKey): Promise<{ ok: true } | { ok: false; error: string }> {
    await assertPermission(this.repos.auditLog, account, 'adoption:decide', 'standard:decline', key, account.inn);
    const idx = await this.index(key);
    const latest = this.visibleLatest(idx, account.inn)?.no;
    const adopted = await this.adoptedNo(account.inn, key);
    if (!latest || adopted === null || latest <= adopted) return { ok: false, error: 'Нет непринятой редакции' };
    await this.setAdoption(account.inn, key, { adopted, declined: latest, at: todayString(), byId: account.id });
    await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn: account.inn, action: 'standard:declined', target: key, meta: { edition: latest }, allowed: true });
    return { ok: true };
  }

  /** Телеметрия внедрения для методиста: кто на какой редакции, кто отклонил, кто не отреагировал. */
  async adoptionReport(account: Account): Promise<AdoptionReportRow[]> {
    await assertPermission(this.repos.auditLog, account, 'clinic:read', 'standard:adoption-report', null, null);
    const tenants = await this.repos.tenants.listAll();
    const rows: AdoptionReportRow[] = [];
    for (const key of Object.keys(CATALOGS) as CatalogKey[]) {
      const idx = await this.index(key);
      const latest = idx.at(-1)?.no;
      if (!latest) continue;
      const pilotMeta = idx.find((e) => e.pilot);
      const row: AdoptionReportRow = { catalog: key, label: CATALOGS[key], latest, accepted: 0, pending: 0, declined: 0, tenants: [], pilot: pilotMeta ? { no: pilotMeta.no, inns: pilotMeta.pilot! } : null };
      for (const t of tenants) {
        const rec = (await this.getAdoption(t.inn)).data[key];
        const tenantLatest = this.visibleLatest(idx, t.inn)?.no ?? latest;
        const adopted = rec && idx.some((e) => e.no === rec.adopted) ? rec.adopted : tenantLatest; // без записи клиника получит последнюю доступную при первом чтении
        const status = adopted === tenantLatest ? 'current' : rec?.declined === tenantLatest ? 'declined' : 'pending';
        row[status === 'current' ? 'accepted' : status]++;
        row.tenants.push({ inn: t.inn, name: t.name, adopted, status });
      }
      rows.push(row);
    }
    return rows;
  }

  /** История выпущенных редакций каталога (для панели методиста). */
  async history(account: Account): Promise<{ catalog: CatalogKey; label: string; editions: EditionMeta[] }[]> {
    await assertPermission(this.repos.auditLog, account, 'standard:read', 'standard:history', null, null);
    const out: { catalog: CatalogKey; label: string; editions: EditionMeta[] }[] = [];
    for (const key of Object.keys(CATALOGS) as CatalogKey[]) out.push({ catalog: key, label: CATALOGS[key], editions: await this.index(key) });
    return out;
  }

  /** Пилот прошёл — выпуск редакции для всех клиник (право публикации; клиники увидят её как обычную рекомендацию). */
  async release(account: Account, key: CatalogKey, no: number): Promise<{ ok: true } | { ok: false; error: string }> {
    await assertPermission(this.repos.auditLog, account, 'standard:publish', 'standard:release', `${key}:${no}`, null);
    for (let attempt = 0; attempt < 5; attempt++) {
      const idx = await this.repos.channels.get<EditionMeta[]>('platform', null, idxKey(key), []);
      const meta = idx.data.find((e) => e.no === no);
      if (!meta) return { ok: false, error: 'Редакция не найдена' };
      if (!meta.pilot) return { ok: false, error: 'Редакция уже выпущена для всех' };
      const next = idx.data.map((e) => (e.no === no ? { ...e, pilot: undefined } : e));
      const res = await this.repos.channels.set('platform', null, idxKey(key), JSON.parse(JSON.stringify(next)), { expectedVersion: idx.version, updatedBy: account.id });
      if (res.ok) {
        await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn: null, action: 'standard:released', target: key, meta: { edition: no }, allowed: true });
        return { ok: true };
      }
    }
    return { ok: false, error: 'Не удалось выпустить — повторите' };
  }

  /**
   * Откат клиники на предыдущую (уже принимавшуюся или общую) редакцию. Новая остаётся
   * помеченной «отклонена» — не предлагается заново, пока не выйдет следующая.
   */
  async rollback(account: Account, key: CatalogKey, toNo: number): Promise<{ ok: true; adopted: number } | { ok: false; error: string }> {
    await assertPermission(this.repos.auditLog, account, 'adoption:decide', 'standard:rollback', `${key}:${toNo}`, account.inn);
    const idx = await this.index(key);
    const adopted = await this.adoptedNo(account.inn, key);
    const target = idx.find((e) => e.no === toNo);
    if (adopted === null || !target || toNo >= adopted) return { ok: false, error: 'Откатиться можно только на более раннюю редакцию' };
    if (target.pilot && !target.pilot.includes(account.inn)) return { ok: false, error: 'Эта редакция вам недоступна' };
    await this.setAdoption(account.inn, key, { adopted: toNo, declined: this.visibleLatest(idx, account.inn)?.no ?? null, at: todayString(), byId: account.id });
    await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn: account.inn, action: 'standard:rolled-back', target: key, meta: { from: adopted, to: toNo }, allowed: true });
    return { ok: true, adopted: toNo };
  }

  /** Редакции, на которые клиника может откатиться (раньше принятой и доступные ей). */
  async rollbackTargets(account: Account, key: CatalogKey): Promise<EditionMeta[]> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'standard:rollback-targets', key, account.inn);
    const adopted = await this.adoptedNo(account.inn, key);
    if (adopted === null) return [];
    return (await this.index(key)).filter((e) => e.no < adopted && (!e.pilot || e.pilot.includes(account.inn)));
  }
}
