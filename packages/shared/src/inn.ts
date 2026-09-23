/**
 * ИНН — ключ арендатора (клиники). Логика перенесена дословно из
 * `reference/prototype/auth.js` (normInn, validInn, innChecksum).
 */

export function normInn(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** ИНН юрлица — 10 цифр, ИП — 12. */
export function validInn(v: unknown): boolean {
  const s = normInn(v);
  return s.length === 10 || s.length === 12;
}

/**
 * Контрольный разряд по алгоритму ФНС. Это ПРЕДУПРЕЖДЕНИЕ, а не отказ во входе —
 * блокировать по нему нельзя (в базе могут жить условные ИНН демо-клиник), но
 * промолчать об опечатке тоже нельзя: из-за неё заводится «вторая клиника».
 */
export function innChecksum(v: unknown): boolean {
  const s = normInn(v);
  if (s.length !== 10 && s.length !== 12) return false;
  const d = s.split('').map(Number);
  const sum = (w: number[]) => w.reduce((a, k, i) => a + k * (d[i] ?? 0), 0) % 11 % 10;
  if (s.length === 10) return sum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  return sum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && sum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}
