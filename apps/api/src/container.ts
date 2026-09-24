import type { PrismaClient } from '@prisma/client';
import { isRole, isPlatformRole, isClinicRole, type Permission, type SecondHandAction } from '@kontur785/shared';
import type { Repos } from './domain/ports.js';
import { SystemClock } from './infra/memory/systemClock.js';
import { ConsoleNotifier } from './infra/memory/notifier.js';
import { HttpNotifier } from './infra/providers/httpNotifier.js';
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
import { ProfileService } from './clinic/profileService.js';
import { InventoryService } from './clinic/inventoryService.js';
import { DashboardService } from './panel/dashboardService.js';
import { TariffService } from './panel/tariffService.js';
import { SubscriptionService } from './panel/subscriptionService.js';
import { BulkOperationService, type BulkActionDef } from './panel/bulkService.js';
import { WorkQueueService } from './panel/workQueueService.js';
import { addDays, todayString } from './shared/date.js';

export interface SecondHandHandler {
  /**
   * Право, которым должен обладать ПОДТВЕРЖДАЮЩИЙ — своё для каждого типа
   * операции (SERVER.md §4). Функция вместо константы — только для
   * `bulk:clinics`, где право зависит от вида пачки (методология/деньги, см.
   * `BULK_ACTIONS` ниже); для остальных шести операций право фиксировано.
   */
  confirmPermission: Permission | ((payload: Record<string, unknown>) => Permission);
  apply: (payload: Record<string, unknown>, confirmedById: string) => Promise<unknown>;
}

export function resolveConfirmPermission(handler: SecondHandHandler, payload: Record<string, unknown>): Permission {
  return typeof handler.confirmPermission === 'function' ? handler.confirmPermission(payload) : handler.confirmPermission;
}

/**
 * Сборка приложения на реальных (Prisma) адаптерах. Тесты используют
 * `testUtil/memoryRepos.ts` вместо этой сборки — сервисы от источника
 * данных не зависят (порты в domain/ports.ts).
 *
 * SERVER.md §7 "до запуска решить" — закрыто: SMS.ru/Resend через HttpNotifier
 * (infra/providers/httpNotifier.ts), если ключи заданы; иначе ConsoleNotifier
 * для дев-стенда без реальной отправки (см. .env.example).
 */
export interface ContainerOptions {
  auditLogSecret: string;
  smsApiKey?: string;
  emailApiKey?: string;
  emailFrom: string;
}

export function buildContainer(prisma: PrismaClient, opts: ContainerOptions) {
  const repos: Repos = {
    clock: new SystemClock(),
    tenants: new PrismaTenantRepo(prisma),
    accounts: new PrismaAccountRepo(prisma),
    sessions: new PrismaSessionRepo(prisma),
    otps: new PrismaOtpRepo(prisma),
    auditLog: new PrismaAuditLog(prisma, opts.auditLogSecret),
    secondHand: new PrismaSecondHandRepo(prisma),
    documentGrants: new PrismaDocumentGrantRepo(prisma),
    channels: new PrismaChannelStore(prisma),
    executorMarks: new PrismaExecutorMarkRepo(prisma),
    files: new LocalDiskFileStorage(process.env.FILES_DIR || './var/uploads'),
    notifier: opts.smsApiKey || opts.emailApiKey ? new HttpNotifier(opts.smsApiKey, opts.emailApiKey, opts.emailFrom) : new ConsoleNotifier(),
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
  const documents = new DocumentService(repos);
  const catalog = new CatalogService(repos, secondHand);
  const cycle = new CycleService(repos);
  const tariff = new TariffService(repos, secondHand);
  const subscription = new SubscriptionService(repos);

  // Реестр массовых операций (README «Дашборд», прототип — bulkPrepare/bulkCommit):
  // одна запись — один пункт меню «Массовые операции» в панели. `kind` решает,
  // каким правом подтверждается пачка больше SECOND_BULK клиник (bulkService.ts).
  const BULK_ACTIONS: Record<string, BulkActionDef> = {
    'subscription-extend': {
      label: 'Продление подписки', requestPermission: 'sub:write', kind: 'money', undoable: true,
      channelKey: () => 'subscription',
      check: async (_repos, tenantInn) => {
        const state = await subscription.getState(tenantInn);
        if (!state.tariffKey || state.status === 'none' || state.status === 'cancelled') {
          return { ok: false, why: 'нет активной подписки — продлевать нечего' };
        }
        const base = state.expiresAt ?? todayString();
        return { ok: true, preview: `${base} → ${addDays(base, 30)} (+30 дн.)` };
      },
      apply: async (_repos, tenantInn, byId) => {
        await subscription.applyRenew(tenantInn, 30, byId);
      },
    },
    'subscription-remind': {
      label: 'Напоминание об оплате', requestPermission: 'bulk:money', kind: 'money', undoable: false,
      channelKey: () => null,
      check: async (_repos, tenantInn) => {
        const state = await subscription.getState(tenantInn);
        if (!state.tariffKey) return { ok: false, why: 'нет подписки — по какой сумме напоминать, неизвестно' };
        const t = (await tariff.getTariffs()).find((x) => x.key === state.tariffKey);
        return { ok: true, preview: t ? `${t.price.toLocaleString('ru-RU')} ₽` : '' };
      },
      // Реальная отправка требует SMS/email-провайдера — не подключен (README «Что дальше»);
      // как и в прототипе (apply: () => {}), данные клиники не меняются, только отчёт о пачке.
      apply: async () => {},
    },
    'cycle-bulk-apply': {
      label: 'Применение годового цикла', requestPermission: 'bulk:methodology', kind: 'standard', undoable: true,
      channelKey: () => 'cycle_live',
      check: async (r, tenantInn) => {
        const master = await cycle.getMaster();
        if (!master) return { ok: false, why: 'цикл ещё не опубликован методистом' };
        const own = (await r.channels.get<{ dirs: unknown[] }>('tenant', tenantInn, 'cycle_live', { dirs: [] })).data;
        return { ok: true, preview: own.dirs.length ? 'свой цикл будет заменён' : 'цикла не было — будет создан' };
      },
      apply: async (_repos, tenantInn, byId) => {
        await cycle.applyMasterToTenant(tenantInn, byId);
      },
    },
  };
  const bulk = new BulkOperationService(repos, secondHand, BULK_ACTIONS);

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
        const target = await repos.accounts.findById(accountId);
        if (!target) throw new Error('Учётная запись не найдена');
        // Роль обязана соответствовать стороне учётной записи — иначе повышение
        // сделало бы сотрудника клиники платформенным (или наоборот), минуя
        // регистрацию и подрывая изоляцию арендатора (см. AuthService.register).
        if (target.side === 'clinic' && !isClinicRole(newRole)) throw new Error('Эта роль не предназначена для клиники');
        if (target.side === 'platform' && !isPlatformRole(newRole)) throw new Error('Эта роль не предназначена для сотрудника платформы');
        return repos.accounts.update(accountId, { role: newRole });
      },
    },
    'money:confirm': {
      // SERVER.md §4: подтверждение оплаты от SECOND_SUM ₽ — сотрудник со
      // вторым правом (руководитель продаж/администратор), не просто любой
      // держатель money:write (иначе два менеджера подтвердили бы друг другу).
      confirmPermission: 'second:money',
      apply: payment.applyFromSecondHand,
    },
    'standard:publish': {
      confirmPermission: 'second:standard',
      apply: catalog.applyPublish,
    },
    'tariff:publish': {
      confirmPermission: 'second:money',
      apply: tariff.applyPublish,
    },
    'tariff:delete': {
      confirmPermission: 'second:money',
      apply: tariff.applyDelete,
    },
    'doc:grant-without-payment': {
      confirmPermission: 'doc:grant',
      apply: documents.grantFromSecondHand,
    },
    'bulk:clinics': {
      confirmPermission: (payload) => (BULK_ACTIONS[String(payload.actionKey)]?.kind === 'standard' ? 'second:standard' : 'second:money'),
      apply: bulk.applyFromSecondHand,
    },
  };

  return {
    repos,
    auth: new AuthService(repos),
    secondHand,
    secondHandHandlers,
    documents,
    executor: new ExecutorService(repos),
    walk: new WalkService(repos),
    staff: new StaffService(repos),
    plan: new PlanService(repos),
    capa,
    stage: new StageService(repos),
    catalog,
    payment,
    branch: new BranchService(repos),
    cycle,
    equipment: new EquipmentService(repos),
    summary: new SummaryService(repos),
    selfAudit: new SelfAuditService(repos, capa),
    profile: new ProfileService(repos),
    inventory: new InventoryService(repos),
    dashboard: new DashboardService(repos, documents),
    tariff,
    subscription,
    bulk,
    queue: new WorkQueueService(repos),
  };
}

export type Container = ReturnType<typeof buildContainerFromRepos>;
