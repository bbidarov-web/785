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
