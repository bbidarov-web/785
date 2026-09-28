import { randomUUID } from 'node:crypto';
import { validInn, normInn } from '@kontur785/shared';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission, PermissionDeniedError } from '../rbac/service.js';
import type { ChecklistDef } from '../shared/channelShapes.js';
import { StandardEditionService } from '../standard/editions.js';
import { EMPTY_OVERLAY, NETWORKS_KEY, findNetworkByInn, loadNetworks, loadOverlay, normName, overlayKey, type Network, type NetworkOverlay } from './store.js';

export type NetResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_CHECKLISTS = 50;
const MAX_ITEMS = 100;

export interface NetworkView {
  id: string;
  name: string;
  headInn: string;
  members: { inn: string; name: string }[];
}

export interface MyNetwork {
  network: { id: string; name: string; headInn: string; headName: string; memberCount: number };
  isHead: boolean;
  members: { inn: string; name: string }[] | null; // состав видит только головная клиника
  overlay: NetworkOverlay;
  /** Сетевые чек-листы, скрытые одноимённым эталонным (эталон главнее). */
  shadowed: string[];
}

/**
 * Собственный стандарт сети поверх эталона методиста. Сети заводит и наполняет составом
 * администратор платформы (`role:manage`); свой слой каталога ведёт администратор ГОЛОВНОЙ
 * клиники (`org:write`) — участницы сети получают его сразу, без редакций и второй руки:
 * это внутренний стандарт организации, а не эталон платформы (тот по-прежнему идёт через
 * методиста, вторую руку и редакции).
 */
export class NetworkService {
  constructor(private repos: Repos) {}

  private async names(inns: string[]): Promise<{ inn: string; name: string }[]> {
    return Promise.all(inns.map(async (inn) => ({ inn, name: (await this.repos.tenants.findByInn(inn))?.name ?? `ИНН ${inn}` })));
  }

  private async mutate(account: Account, fn: (list: Network[]) => NetResult<{ list: Network[] }>): Promise<NetResult<Record<string, unknown>>> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await loadNetworks(this.repos);
      const r = fn(rec.data.map((n) => ({ ...n, members: n.members.slice() })));
      if (!r.ok) return r;
      const res = await this.repos.channels.set('platform', null, NETWORKS_KEY, JSON.parse(JSON.stringify(r.list)), { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true };
    }
    return { ok: false, error: 'Не удалось сохранить — повторите' };
  }

  private async log(account: Account, action: string, target: string, meta: Record<string, unknown> | null) {
    await this.repos.auditLog.append({ actorId: account.id, actorRole: account.role, tenantInn: null, action, target, meta, allowed: true });
  }

  async listAll(account: Account): Promise<NetworkView[]> {
    await assertPermission(this.repos.auditLog, account, 'role:manage', 'network:list', null, null);
    const nets = (await loadNetworks(this.repos)).data;
    return Promise.all(nets.map(async (n) => ({ id: n.id, name: n.name, headInn: n.headInn, members: await this.names(n.members) })));
  }

  async create(account: Account, name: string, headInnRaw: string): Promise<NetResult<{ id: string }>> {
    await assertPermission(this.repos.auditLog, account, 'role:manage', 'network:create', headInnRaw, null);
    const headInn = normInn(headInnRaw);
    if (!name.trim()) return { ok: false, error: 'Укажите название сети' };
    if (!validInn(headInn)) return { ok: false, error: 'ИНН головной клиники: 10 цифр для юрлица или 12 для ИП' };
    if (!(await this.repos.tenants.findByInn(headInn))) return { ok: false, error: 'Клиника с таким ИНН не зарегистрирована' };
    const id = randomUUID().slice(0, 8);
    const r = await this.mutate(account, (list) => {
      if (list.some((n) => n.members.includes(headInn))) return { ok: false, error: 'Эта клиника уже входит в другую сеть' };
      return { ok: true, list: list.concat([{ id, name: name.trim(), headInn, members: [headInn], createdAt: this.repos.clock.now().toISOString() }]) };
    });
    if (!r.ok) return r;
    await this.log(account, 'network:create', id, { name: name.trim(), headInn });
    return { ok: true, id };
  }

  async addMember(account: Account, id: string, innRaw: string): Promise<NetResult<Record<string, unknown>>> {
    await assertPermission(this.repos.auditLog, account, 'role:manage', 'network:add-member', id, null);
    const inn = normInn(innRaw);
    if (!validInn(inn)) return { ok: false, error: 'Некорректный ИНН' };
    if (!(await this.repos.tenants.findByInn(inn))) return { ok: false, error: 'Клиника с таким ИНН не зарегистрирована' };
    const r = await this.mutate(account, (list) => {
      const net = list.find((n) => n.id === id);
      if (!net) return { ok: false, error: 'Сеть не найдена' };
      if (list.some((n) => n.members.includes(inn))) return { ok: false, error: 'Эта клиника уже входит в сеть' };
      net.members.push(inn);
      return { ok: true, list };
    });
    if (r.ok) await this.log(account, 'network:add-member', id, { inn });
    return r;
  }

  async removeMember(account: Account, id: string, innRaw: string): Promise<NetResult<Record<string, unknown>>> {
    await assertPermission(this.repos.auditLog, account, 'role:manage', 'network:remove-member', id, null);
    const inn = normInn(innRaw);
    const r = await this.mutate(account, (list) => {
      const net = list.find((n) => n.id === id);
      if (!net) return { ok: false, error: 'Сеть не найдена' };
      if (net.headInn === inn) return { ok: false, error: 'Головную клинику из сети не убрать — удалите сеть целиком' };
      if (!net.members.includes(inn)) return { ok: false, error: 'Клиники нет в этой сети' };
      net.members = net.members.filter((m) => m !== inn);
      return { ok: true, list };
    });
    if (r.ok) await this.log(account, 'network:remove-member', id, { inn });
    return r;
  }

  async remove(account: Account, id: string): Promise<NetResult<Record<string, unknown>>> {
    await assertPermission(this.repos.auditLog, account, 'role:manage', 'network:delete', id, null);
    const r = await this.mutate(account, (list) => (list.some((n) => n.id === id) ? { ok: true, list: list.filter((n) => n.id !== id) } : { ok: false, error: 'Сеть не найдена' }));
    if (r.ok) await this.log(account, 'network:delete', id, null);
    return r;
  }

  /** Сеть, в которую входит клиника пользователя (null — не в сети). Состав раскрывается только головной. */
  async mine(account: Account): Promise<MyNetwork | null> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'network:mine', null, account.inn);
    const net = await findNetworkByInn(this.repos, account.inn);
    if (!net) return null;
    const isHead = net.headInn === account.inn;
    const overlay = (await loadOverlay(this.repos, net.id)).data;
    const base = await new StandardEditionService(this.repos).baseCatalog<ChecklistDef[]>(account.inn, 'checklists', []);
    const taken = new Set(base.map((c) => normName(c.name)));
    return {
      network: { id: net.id, name: net.name, headInn: net.headInn, headName: (await this.repos.tenants.findByInn(net.headInn))?.name ?? `ИНН ${net.headInn}`, memberCount: net.members.length },
      isHead,
      members: isHead ? await this.names(net.members) : null,
      overlay,
      shadowed: overlay.checklists.filter((c) => taken.has(normName(c.name))).map((c) => c.name),
    };
  }

  /** Заменяет сетевой слой чек-листов целиком. Только администратор головной клиники. */
  async setChecklists(account: Account, input: ChecklistDef[]): Promise<NetResult<{ overlay: NetworkOverlay }>> {
    await assertPermission(this.repos.auditLog, account, 'org:write', 'network:set-checklists', null, account.inn);
    const net = await findNetworkByInn(this.repos, account.inn);
    if (!net || net.headInn !== account.inn) throw new PermissionDeniedError('network:head');
    if (input.length > MAX_CHECKLISTS) return { ok: false, error: `Не больше ${MAX_CHECKLISTS} чек-листов` };
    const base = await new StandardEditionService(this.repos).baseCatalog<ChecklistDef[]>(account.inn, 'checklists', []);
    const master = new Map(base.map((c) => [normName(c.name), c.name]));
    const seen = new Set<string>();
    const clean: ChecklistDef[] = [];
    for (const c of input) {
      const name = String(c.name ?? '').trim();
      const items = (c.items ?? []).map((i) => String(i).trim()).filter(Boolean);
      if (!name) return { ok: false, error: 'У чек-листа нет названия' };
      if (items.length === 0) return { ok: false, error: `В чек-листе «${name}» нет ни одного пункта` };
      if (items.length > MAX_ITEMS) return { ok: false, error: `В чек-листе «${name}» больше ${MAX_ITEMS} пунктов` };
      const key = normName(name);
      if (seen.has(key)) return { ok: false, error: `Чек-лист «${name}» указан дважды` };
      if (master.has(key)) return { ok: false, error: `Название совпадает с эталонным чек-листом «${master.get(key)}» — выберите другое` };
      seen.add(key);
      clean.push({ name, items });
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await loadOverlay(this.repos, net.id);
      const overlay: NetworkOverlay = { ...EMPTY_OVERLAY, checklists: clean, updatedAt: this.repos.clock.now().toISOString() };
      const res = await this.repos.channels.set('platform', null, overlayKey(net.id), JSON.parse(JSON.stringify(overlay)), { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) {
        await this.log(account, 'network:set-checklists', net.id, { count: clean.length });
        return { ok: true, overlay };
      }
    }
    return { ok: false, error: 'Не удалось сохранить — повторите' };
  }
}
