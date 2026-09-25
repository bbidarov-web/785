/** Даты в интерфейсе — ДД.ММ.ГГГГ (reference/CLAUDE.md). Общий разбор/формат для сервисов, которым нужна арифметика дат (подписки, дашборд). */

export function todayString(): string {
  return formatDate(new Date());
}

export function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function parseDate(s: string): Date {
  const [d, m, y] = s.split('.').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function addDays(s: string, days: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function isBeforeToday(s: string): boolean {
  return parseDate(s).getTime() < new Date().setHours(0, 0, 0, 0);
}

/** Сколько полных дней прошло от даты (ДД.ММ.ГГГГ) до сегодня — для просрочек в очереди работы. */
export function daysSince(s: string): number {
  const ms = new Date().setHours(0, 0, 0, 0) - parseDate(s).setHours(0, 0, 0, 0);
  return Math.floor(ms / 86_400_000);
}

/** Сколько полных дней осталось от сегодня до даты (ДД.ММ.ГГГГ) — отрицательное значит дата уже прошла. */
export function daysUntil(s: string): number {
  return -daysSince(s);
}

/**
 * Дата из формы → ДД.ММ.ГГГГ (единственный формат хранения, reference/CLAUDE.md).
 * Браузерный `<input type="date">` отдаёт ГГГГ-ММ-ДД — без нормализации ручные
 * проверки плана и сроки CAPA ломали сортировку обхода и расчёт просрочки
 * (везде дальше даты разбираются как ДД.ММ.ГГГГ). Пустое значение — пустая
 * строка (срок не задан); нераспознанное — null (вызывающий отвечает ошибкой).
 */
export function normalizeDateInput(value: string | undefined | null): string | null {
  const v = (value ?? '').trim();
  if (!v) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const dmy = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
  const [y, m, d] = iso ? [iso[1]!, iso[2]!, iso[3]!] : dmy ? [dmy[3]!, dmy[2]!, dmy[1]!] : [null, null, null];
  if (!y) return null;
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(m) - 1 || dt.getDate() !== Number(d)) return null;
  return `${d}.${m}.${y}`;
}
