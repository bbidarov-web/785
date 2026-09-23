/** Нормализация телефона — перенесено из `reference/prototype/auth.js` (normPhone). */
export function normPhone(p: unknown): string {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length === 11 && (d[0] === '8' || d[0] === '7') ? '7' + d.slice(1) : d;
}
