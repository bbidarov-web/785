import { createHmac } from 'node:crypto';
import type { AuditLogEntry } from '../domain/types.js';

/** Поля записи, входящие в подпись — без `id`/`hash` самой записи (иначе подпись подписывала бы саму себя). */
type ChainableFields = Pick<AuditLogEntry, 'seq' | 'at' | 'actorId' | 'actorRole' | 'tenantInn' | 'action' | 'target' | 'meta' | 'allowed'>;

function canonical(entry: ChainableFields): string {
  return JSON.stringify({
    seq: entry.seq,
    at: entry.at.toISOString(),
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    tenantInn: entry.tenantInn,
    action: entry.action,
    target: entry.target,
    meta: entry.meta,
    allowed: entry.allowed,
  });
}

/**
 * HMAC-SHA256(секрет сервера, prevHash + канонический вид записи) — цепочка
 * хешей поверх append-only журнала (CLAUDE.md, README «Известные
 * ограничения» → закрыто). Секрет никогда не должен покидать сервер: без
 * него нельзя ни подделать запись, ни пересчитать чужую цепочку задним числом.
 */
export function computeEntryHash(secret: string, prevHash: string | null, entry: ChainableFields): string {
  return createHmac('sha256', secret).update((prevHash ?? '') + canonical(entry)).digest('hex');
}

export interface ChainVerifyResult {
  ok: boolean;
  /** Порядковый номер первой записи, на которой цепочка не сходится — null, если цепочка цела или пуста. */
  brokenAtSeq: number | null;
}

/**
 * Пересчитывает цепочку с начала. `entries` — строго по возрастанию `seq`
 * (адаптеры отдают его уже в этом порядке). Разрыв — либо запись изменили,
 * либо запись удалили и следующая ссылается на несуществующий prevHash.
 */
export function verifyChain(secret: string, entries: AuditLogEntry[]): ChainVerifyResult {
  let expectedPrev: string | null = null;
  for (const e of entries) {
    if (e.prevHash !== expectedPrev || computeEntryHash(secret, e.prevHash, e) !== e.hash) {
      return { ok: false, brokenAtSeq: e.seq };
    }
    expectedPrev = e.hash;
  }
  return { ok: true, brokenAtSeq: null };
}
