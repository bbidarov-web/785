/**
 * Разбор поля «назначение» — общая логика для кабинета исполнителя и обхода.
 * Перенесено дословно из `reference/prototype/Кабинет исполнителя.dc.html`
 * (`mine()`) и одноимённого места в `Обход - мобильный.dc.html` (`_ownerOf`):
 * назначение может быть записано на нескольких людей через « + », а рядом
 * с ФИО может стоять филиал через « · » («Смирнов А. П. · Головная клиника»).
 */
export function assignees(who: string | undefined | null): string[] {
  return String(who ?? '')
    .split(/\s*\+\s*/)
    .map((s) => s.split('·')[0]?.trim() ?? '')
    .filter(Boolean);
}

export function isMine(who: string | undefined | null, fio: string): boolean {
  return assignees(who).includes(fio);
}

import type { ClientStateShape, StaffMember } from './channelShapes.js';

/** ФИО → должность, из каталога сотрудников клиники (`staff`) либо из старого `client_state.staffByBranch`. */
export function buildStaffPositionMap(staff: StaffMember[], clientState: ClientStateShape): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of staff) if (p?.fio) map[p.fio.trim()] = p.pos ?? '';
  if (!Object.keys(map).length) {
    for (const list of Object.values(clientState.staffByBranch ?? {})) {
      for (const p of list) if (p?.fio && !map[p.fio.trim()]) map[p.fio.trim()] = p.pos ?? '';
    }
  }
  return map;
}

/**
 * Ответственный с должностью через « · », несколько человек — через « + »
 * (`_ownerOf` в reference/prototype/Обход - мобильный.dc.html). Упрощение
 * относительно прототипа: не подмешивает матрицу назначения документов —
 * там это редкий кросс-справочник, годовой цикл ещё не перенесён.
 */
export function formatOwner(who: string | undefined | null, positions: Record<string, string>): string {
  const list = assignees(who);
  if (!list.length) return 'не назначен';
  return list.map((fio) => (positions[fio] ? `${fio} · ${positions[fio]}` : fio)).join(' + ') || 'не назначен';
}

/**
 * Сопоставление имени чек-листа из плана проверок с каталогом методиста.
 * Перенесено дословно из `Обход - мобильный.dc.html` (`nrm`): убирает кавычки,
 * префикс «1 · », регистр и лишние пробелы — иначе «Чек-лист аудита» и
 * «"Чек-лист  Аудита"» считались бы разными чек-листами.
 */
export function normalizeChecklistName(name: string | undefined | null): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[«»"']/g, '')
    .replace(/^\d+\s*·\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
