/**
 * Требования к паролю — перенесено из `reference/prototype/auth.js` (passwordIssues).
 * Список назван словами, а не проверен молча: пользователь должен понимать, почему
 * пароль не принят.
 */
export function passwordIssues(p: unknown): string[] {
  const s = String(p ?? '');
  const out: string[] = [];
  if (s.length < 8) out.push('не короче 8 символов');
  if (!/[a-zа-яё]/i.test(s)) out.push('хотя бы одна буква');
  if (!/\d/.test(s)) out.push('хотя бы одна цифра');
  if (/^\s|\s$/.test(s)) out.push('без пробелов по краям');
  return out;
}
