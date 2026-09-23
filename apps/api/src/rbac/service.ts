import { can, type Permission } from '@kontur785/shared';
import type { AuditLog } from '../domain/ports.js';
import type { Account } from '../domain/types.js';

export class PermissionDeniedError extends Error {
  constructor(perm: string) {
    super(`Недостаточно прав: ${perm}`);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Проверка права — единая точка входа для ВСЕХ эндпоинтов (CLAUDE.md: "Интерфейс
 * только скрывает недоступное — это не защита"). Отказ тоже пишется в журнал.
 */
export async function assertPermission(
  auditLog: AuditLog,
  account: Account,
  perm: Permission,
  action: string,
  target: string | null,
  tenantInn: string | null,
): Promise<void> {
  const allowed = can(account.role, perm);
  await auditLog.append({
    actorId: account.id,
    actorRole: account.role,
    tenantInn,
    action,
    target,
    meta: { perm },
    allowed,
  });
  if (!allowed) throw new PermissionDeniedError(perm);
}

/**
 * Изоляция арендатора: сотрудник клиники видит только свою клинику. Арендатор
 * ВСЕГДА берётся из сессии (аргумент account), запрошенный ИНН — только сверяется,
 * никогда не подставляется вместо сессионного (SERVER.md §2, CLAUDE.md).
 */
export function assertTenantScope(account: Account, requestedInn: string): void {
  if (account.side === 'clinic' && account.inn !== requestedInn) {
    throw new PermissionDeniedError('tenant:scope');
  }
}
