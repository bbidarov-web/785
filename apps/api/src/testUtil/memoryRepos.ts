import type { Repos } from '../domain/ports.js';
import { TestClock } from '../infra/memory/systemClock.js';
import { InMemoryTenantRepo } from '../infra/memory/tenantRepo.js';
import { InMemoryAccountRepo } from '../infra/memory/accountRepo.js';
import { InMemorySessionRepo } from '../infra/memory/sessionRepo.js';
import { InMemoryOtpRepo } from '../infra/memory/otpRepo.js';
import { InMemoryAuditLog } from '../infra/memory/auditLog.js';
import { InMemorySecondHandRepo } from '../infra/memory/secondHandRepo.js';
import { InMemoryDocumentGrantRepo } from '../infra/memory/documentGrantRepo.js';
import { InMemoryChannelStore } from '../infra/memory/channelStore.js';
import { InMemoryExecutorMarkRepo } from '../infra/memory/executorMarkRepo.js';
import { InMemoryFileStorage } from '../infra/memory/fileStorage.js';
import { InMemoryNotifier } from '../infra/memory/notifier.js';

/** Полный набор in-memory адаптеров — используется во всех юнит/интеграционных тестах API. */
export function createMemoryRepos(): Repos & { clock: TestClock; notifier: InMemoryNotifier } {
  const clock = new TestClock();
  return {
    clock,
    tenants: new InMemoryTenantRepo(),
    accounts: new InMemoryAccountRepo(clock),
    sessions: new InMemorySessionRepo(clock),
    otps: new InMemoryOtpRepo(clock),
    auditLog: new InMemoryAuditLog(clock),
    secondHand: new InMemorySecondHandRepo(clock),
    documentGrants: new InMemoryDocumentGrantRepo(clock),
    channels: new InMemoryChannelStore(clock),
    executorMarks: new InMemoryExecutorMarkRepo(clock),
    files: new InMemoryFileStorage(),
    notifier: new InMemoryNotifier(),
  };
}
