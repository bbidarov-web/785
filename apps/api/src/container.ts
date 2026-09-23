import type { PrismaClient } from '@prisma/client';
import { isRole, type Permission, type SecondHandAction } from '@kontur785/shared';
import type { Repos } from './domain/ports.js';
import { SystemClock } from './infra/memory/systemClock.js';
import { ConsoleNotifier } from './infra/memory/notifier.js';
import { PrismaTenantRepo } from './infra/prisma/tenantRepo.js';
import { PrismaAccountRepo } from './infra/prisma/accountRepo.js';
import { PrismaSessionRepo } from './infra/prisma/sessionRepo.js';
import { PrismaOtpRepo } from './infra/prisma/otpRepo.js';
import { PrismaAuditLog } from './infra/prisma/auditLog.js';
import { PrismaSecondHandRepo } from './infra/prisma/secondHandRepo.js';
import { PrismaDocumentGrantRepo } from './infra/prisma/documentGrantRepo.js';
import { PrismaChannelStore } from './infra/prisma/channelStore.js';
import { PrismaExecutorMarkRepo } from './infra/prisma/executorMarkRepo.js';
import { LocalDiskFileStorage } from './infra/files/localDiskFileStorage.js';
import { AuthService } from './auth/service.js';
import { SecondHandService } from './secondHand/service.js';
import { DocumentService } from './documents/service.js';
import { ExecutorService } from './executor/service.js';
import { WalkService } from './walk/service.js';
import { StaffService } from './clinic/staffService.js';
import { PlanService } from './clinic/planService.js';
import { CapaService } from './clinic/capaService.js';
import { StageService } from './clinic/stageService.js';
import { CatalogService } from './panel/catalogService.js';
import { PaymentService } from './panel/paymentService.js';
import { BranchService } from './clinic/branchService.js';
import { CycleService } from './clinic/cycleService.js';
import { EquipmentService } from './clinic/equipmentService.js';
import { SummaryService } from './clinic/summaryService.js';
import { SelfAuditService } from './clinic/selfAuditService.js';
import { DashboardService } from './panel/dashboardService.js';

export interface SecondHandHandler {
  /** Право, которым должен обладать ПОДТВЕРЖДАЮЩИЙ — своё для каждого типа операции (SERVER.md §4). */
  confirmPermission: Permission;
  apply: (payload: Record<string, unknown>, confirmedById: string) => Promise<unknown>;
}

/**
 * Сборка приложения на реальных (Prisma) адаптерах. Тесты используют
 * `testUtil/memoryRepos.ts` вместо этой сборки — сервисы от источника
 * данных не зависят (порты в domain/ports.ts).
 *
 * SERVER.md §7 "до запуска решить": ConsoleNotifier печатает коды 2FA/сброса
 * в лог сервера — замените на реальный шлюз смс/почты до продакшена
 * (см. .env.example и заготовки в infra/providers, когда провайдер выбран).
 */
export function buildContainer(prisma: PrismaClient) {
  const repos: Repos = {
    clock: new SystemClock(),
    tenants: new PrismaTenantRepo(prisma),
    accounts: new PrismaAccountRepo(prisma),
    sessions: new PrismaSessionRepo(prisma),
    otps: new PrismaOtpRepo(prisma),
    auditLog: new PrismaAuditLog(prisma),
    secondHand: new PrismaSecondHandRepo(prisma),
    documentGrants: new PrismaDocumentGrantRepo(prisma),
    channels: new PrismaChannelStore(prisma),
    executorMarks: new PrismaExecutorMarkRepo(prisma),
    files: new LocalDiskFileStorage(process.env.FILES_DIR || './var/uploads'),
    notifier: new ConsoleNotifier(),
  };
  return buildContainerFromRepos(repos);
}

/**
 * Сборка сервисного слоя поверх ЛЮБОГО набора репозиториев, реализующих порты
 * из domain/ports.ts. Используется и продовой сборкой (Prisma-репозитории выше),
 * и HTTP-интеграционными тестами (`testUtil/memoryRepos.ts`) — сервисы от
 * конкретного хранилища не зависят.
 */
export function buildContainerFromRepos(repos: Repos) {
  const secondHand = new SecondHandService(repos);
  const payment = new PaymentService(repos, secondHand);
  const capa = new CapaService(repos);

  // Реестр операций «второй руки»: по типу запроса — кто вправе подтвердить
  // и что применить при подтверждении. Единая точка, а не разбросанные по
  // роутам ветки — добавляя новую операцию, трогаем только этот объект и
  // сам сервис, не общий эндпоинт подтверждения (apps/api/src/http/routes/secondHand.ts).
  const secondHandHandlers: Partial<Record<SecondHandAction, SecondHandHandler>> = {
    'role:elevate': {
      confirmPermission: 'role:manage',
      apply: async (payload) => {
        const accountId = String(payload.accountId);
        const newRole = String(payload.newRole);
        if (!isRole(newRole)) throw new Error('Неизвестная роль в запросе');
        return repos.accounts.update(accountId, { role: newRole });
      },
    },
    'money:confirm': {
      confirmPermission: 'money:write',
      apply: payment.applyFromSecondHand,
    },
  };

  return {
    repos,
    auth: new AuthService(repos),
    secondHand,
    secondHandHandlers,
    documents: new DocumentService(repos),
    executor: new ExecutorService(repos),
    walk: new WalkService(repos),
    staff: new StaffService(repos),
    plan: new PlanService(repos),
    capa,
    stage: new StageService(repos),
    catalog: new CatalogService(repos),
    payment,
    branch: new BranchService(repos),
    cycle: new CycleService(repos),
    equipment: new EquipmentService(repos),
    summary: new SummaryService(repos),
    selfAudit: new SelfAuditService(repos, capa),
    dashboard: new DashboardService(repos),
  };
}

export type Container = ReturnType<typeof buildContainerFromRepos>;
