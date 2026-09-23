/**
 * Матрица ролей и прав — единый источник правды.
 *
 * Перенесена дословно из прототипа `reference/prototype/platform.js` (экспорт `ROLES`).
 * Это НЕ переформулировка: сервер обязан проверять ТУ ЖЕ матрицу (SERVER.md, раздел 4),
 * поэтому любое изменение здесь должно быть согласовано с продуктом и отражено
 * и в API, и в интерфейсе. Не редактируйте этот файл, не сверившись с прототипом.
 */

export const ROLES = {
  methodist: {
    name: 'Методист платформы',
    short: 'методист',
    perms: [
      'standard:read', 'standard:write', 'standard:publish', 'revision:write', 'clinic:read', 'journal:read',
      'audit:manage', 'message:send', 'money:read', 'bulk:methodology', 'second:standard', 'doc:grant',
    ],
  },
  sales_manager: {
    name: 'Менеджер по продажам',
    short: 'менеджер',
    perms: [
      'standard:read', 'clinic:read', 'journal:read',
      'money:read', 'money:write', 'tariff:write', 'sub:write', 'message:send', 'bulk:money', 'doc:grant',
    ],
  },
  sales_head: {
    name: 'Руководитель продаж',
    short: 'руководитель продаж',
    perms: [
      'standard:read', 'clinic:read', 'journal:read',
      'money:read', 'money:write', 'tariff:write', 'sub:write', 'message:send', 'bulk:money', 'second:money', 'doc:grant',
    ],
  },
  platform_admin: {
    name: 'Администратор платформы',
    short: 'администратор',
    perms: [
      'standard:read', 'standard:write', 'standard:publish', 'revision:write', 'clinic:read', 'journal:read',
      'audit:manage', 'message:send', 'money:read', 'money:write', 'tariff:write', 'sub:write',
      'bulk:methodology', 'bulk:money', 'role:manage', 'second:money', 'second:standard', 'doc:grant',
    ],
  },
  clinic_admin: {
    name: 'Администратор клиники',
    short: 'админ клиники',
    perms: [
      'standard:read', 'org:write', 'adoption:decide', 'doc:read', 'doc:write', 'tariff:read', 'order:write',
      'journal:read', 'journal:write', 'plan:read', 'plan:write', 'capa:write', 'staff:manage',
    ],
  },
  vkk_lead: {
    name: 'Ответственный за ВКК',
    short: 'ответственный за ВКК',
    perms: [
      'standard:read', 'adoption:decide', 'doc:read', 'doc:write', 'plan:read', 'plan:write', 'walk:run',
      'capa:write', 'journal:read', 'journal:write',
    ],
  },
  nurse: {
    name: 'Медсестра / исполнитель',
    short: 'исполнитель',
    perms: ['doc:read', 'plan:read', 'journal:read', 'journal:write', 'walk:run', 'capa:own'],
  },
  auditor: {
    name: 'Аудитор',
    short: 'аудитор',
    perms: ['doc:read', 'plan:read', 'walk:run', 'capa:own', 'journal:read'],
  },
  observer: {
    name: 'Наблюдатель',
    short: 'наблюдатель',
    perms: ['doc:read', 'plan:read', 'journal:read'],
  },
} as const;

export type Role = keyof typeof ROLES;
export type Permission = (typeof ROLES)[Role]['perms'][number];

export const PLATFORM_ROLES: readonly Role[] = ['methodist', 'sales_manager', 'sales_head', 'platform_admin'];
export const CLINIC_ROLES: readonly Role[] = ['clinic_admin', 'vkk_lead', 'nurse', 'auditor', 'observer'];

export function isRole(value: string): value is Role {
  return Object.prototype.hasOwnProperty.call(ROLES, value);
}

export function isPlatformRole(role: Role): boolean {
  return (PLATFORM_ROLES as readonly string[]).includes(role);
}

export function isClinicRole(role: Role): boolean {
  return (CLINIC_ROLES as readonly string[]).includes(role);
}

export function roleName(role: Role): string {
  return ROLES[role]?.name ?? role;
}

/** Право проверяется на КАЖДОМ эндпоинте — интерфейс только скрывает недоступное (CLAUDE.md). */
export function can(role: Role, perm: Permission): boolean {
  const entry = ROLES[role];
  if (!entry) return false;
  return (entry.perms as readonly string[]).includes(perm);
}

export const PLATFORM_TENANT = '__platform__';

/** Семь необратимых операций требуют подтверждения ВТОРЫМ сотрудником (SERVER.md §4). */
export const SECOND_HAND_ACTIONS = [
  'role:elevate',
  'standard:publish',
  'tariff:publish',
  'tariff:delete',
  'bulk:clinics', // массовая операция больше SECOND_BULK клиник
  'money:confirm', // подтверждение оплаты от SECOND_SUM ₽
  'doc:grant-without-payment',
] as const;

export type SecondHandAction = (typeof SECOND_HAND_ACTIONS)[number];

export function isSecondHandAction(value: string): value is SecondHandAction {
  return (SECOND_HAND_ACTIONS as readonly string[]).includes(value);
}
