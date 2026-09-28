import type { Repos } from '../domain/ports.js';
import type { ChecklistDef } from '../shared/channelShapes.js';

/**
 * Сеть клиник — несколько ИНН под одной головной организацией. Сеть НЕ арендатор: данные клиник
 * остаются изолированными по ИНН; сеть только добавляет к эталону методиста свой слой каталога,
 * который получают все её клиники. Хранится в платформенных каналах (миграция БД не нужна).
 */
export interface Network {
  id: string;
  name: string;
  headInn: string;
  /** Все ИНН сети, включая головной. */
  members: string[];
  createdAt: string;
}

/** Собственный стандарт сети поверх эталона. Пока — дополнительные чек-листы. */
export interface NetworkOverlay {
  checklists: ChecklistDef[];
  updatedAt: string | null;
}

export const NETWORKS_KEY = 'networks';
export const overlayKey = (id: string) => `network_overlay:${id}`;
export const EMPTY_OVERLAY: NetworkOverlay = { checklists: [], updatedAt: null };

export async function loadNetworks(repos: Repos): Promise<{ data: Network[]; version: number }> {
  return repos.channels.get<Network[]>('platform', null, NETWORKS_KEY, []);
}

export async function findNetworkByInn(repos: Repos, inn: string): Promise<Network | null> {
  return (await loadNetworks(repos)).data.find((n) => n.members.includes(inn)) ?? null;
}

export async function loadOverlay(repos: Repos, networkId: string): Promise<{ data: NetworkOverlay; version: number }> {
  return repos.channels.get<NetworkOverlay>('platform', null, overlayKey(networkId), EMPTY_OVERLAY);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/** Чек-листы клиники: эталон + чек-листы её сети. Одноимённый эталонный чек-лист всегда главнее сетевого. */
export async function mergeChecklists(repos: Repos, inn: string, base: ChecklistDef[]): Promise<ChecklistDef[]> {
  const network = await findNetworkByInn(repos, inn);
  if (!network) return base;
  const overlay = (await loadOverlay(repos, network.id)).data;
  const taken = new Set(base.map((c) => norm(c.name)));
  return base.concat(overlay.checklists.filter((c) => !taken.has(norm(c.name))));
}

export { norm as normName };
