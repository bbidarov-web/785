'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { ResetPasswordForm, ChangePasswordDialog, OtpStep, TwoFactorDialog, authLinkBtn, type TwoFactorState } from '../AuthForms';
import {
  StageCatalogForm, CycleMasterForm, EquipTypesForm, SummaryMasterForm,
  type StageDraft, type CycleMasterDraft, type EquipTypeDraft, type SummaryRowDraft,
} from './catalogForms';
import {
  TariffsForm, SubscriptionsPanel, BulkOperationsPanel, ClientCatalogTab,
  type TariffDraft, type SubscriptionRow, type SubscriptionSummary, type BulkPreviewRow, type BulkReport, type BulkJob,
  type FinancialSummary, type PortfolioSummary, type RichClientRow,
} from './salesForms';
import { StagePaymentsList, DocumentGrantsTab, type StagePaymentRow } from './linkForms';
import { WorkQueueTab, type QueueTask, type DigestSettings } from './queueForms';

/**
 * Общая реализация панели платформы (README «Эталоны», «Дашборд»; SERVER.md
 * §4 «вторая рука») — публикация каталогов через вторую руку, оплата и
 * приёмка этапа, тарифы, подписки, массовые операции с откатом, финансовая
 * сводка, заявки на доступ, вторая рука на все семь операций.
 *
 * Это ЕДИНАЯ реализация для четырёх самостоятельных кабинетов
 * (`/panel` — администратор, `/panel/methodist`, `/panel/manager`,
 * `/panel/head`) — функционал и вид одинаковы для всех ролей, различается
 * только вход: `allowedRoles` решает, чья учётная запись открывает конкретный
 * кабинет (сервер всё равно проверяет права на каждом эндпоинте — это
 * разделение входа, а не защита). Права внутри (`canPublish`, `canConfirm...`)
 * по-прежнему считаются от РЕАЛЬНОЙ роли сессии, поэтому если когда-нибудь
 * один кабинет пустят под несколько ролей — раскладка кнопок не потребует правки.
 */

interface SessionInfo extends TwoFactorState {
  mustChange?: boolean;
  accountId?: string;
  role: string;
  side: 'platform' | 'clinic';
  fio: string;
}

interface ManagerAssignmentRow {
  managerId: string;
  managerFio: string;
  clinics: { inn: string; name: string }[];
}

interface NetworkRow {
  id: string;
  name: string;
  headInn: string;
  members: { inn: string; name: string }[];
}

interface AdoptionRow {
  catalog: string;
  label: string;
  latest: number;
  accepted: number;
  pending: number;
  declined: number;
  tenants: { inn: string; name: string; adopted: number; status: 'current' | 'pending' | 'declined' }[];
  pilot: { no: number; inns: string[] } | null;
}

interface StaffAccount {
  id: string;
  login: string;
  fio: string;
  role: string;
}

interface PendingAccount {
  id: string;
  inn: string;
  login: string;
  fio: string;
  requestedRole: string | null;
}

interface ChecklistDef {
  name: string;
  items: string[];
}

interface SecondHandItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  tenantInn: string | null;
  requestedById: string;
  requestedAt: string;
  canAct: boolean;
}

const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '14px 16px' };
const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border-1)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, width: '100%' };
const primaryBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' };
const outlineBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 7, border: '1px solid var(--border-1)', background: 'transparent', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };

const ROLE_LABELS: Record<string, string> = { methodist: 'методист', sales_manager: 'менеджер по продажам', sales_head: 'руководитель продаж', platform_admin: 'администратор платформы' };

type Tab = 'accounts' | 'checklists' | 'stages' | 'cycle' | 'equip' | 'summary' | 'tariffs' | 'subscriptions' | 'payments' | 'bulk' | 'queue' | 'secondhand' | 'clients' | 'grants' | 'adoption' | 'networks' | 'managers';

export function PlatformPanelShell({ allowedRoles, heading }: { allowedRoles: string[]; heading: string }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authError, setAuthError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login');
  const [showPw, setShowPw] = useState(false);
  const [show2fa, setShow2fa] = useState(false);
  const [otpVia, setOtpVia] = useState<string | null>(null);
  const [aInn, setAInn] = useState('');
  const [aLogin, setALogin] = useState('');
  const [aPass, setAPass] = useState('');
  const [tab, setTab] = useState<Tab>('accounts');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // «Заявки на доступ» — только у администратора платформы (role:manage); остальным ни вкладки, ни запроса (был 403 на каждой загрузке)
  const isAdminRef = useRef(false);

  const [pending, setPending] = useState<PendingAccount[]>([]);
  const [checklists, setChecklists] = useState<ChecklistDef[]>([]);
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [cycle, setCycle] = useState<CycleMasterDraft | null>(null);
  const [equipTypes, setEquipTypes] = useState<EquipTypeDraft[]>([]);
  const [summaryRows, setSummaryRows] = useState<SummaryRowDraft[]>([]);
  const [secondHand, setSecondHand] = useState<SecondHandItem[]>([]);
  const [clients, setClients] = useState<RichClientRow[]>([]);
  const [tariffs, setTariffs] = useState<TariffDraft[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [subscriptionSummary, setSubscriptionSummary] = useState<SubscriptionSummary | null>(null);
  const [bulkReports, setBulkReports] = useState<BulkReport[]>([]);
  const [bulkJob, setBulkJob] = useState<BulkJob | null>(null);
  const [pilotInns, setPilotInns] = useState('');
  const pilotQs = () => (pilotInns.trim() ? `?pilot=${encodeURIComponent(pilotInns.trim())}` : '');
  const [networks, setNetworks] = useState<NetworkRow[]>([]);
  const [managerAssignments, setManagerAssignments] = useState<ManagerAssignmentRow[]>([]);
  const [adoption, setAdoption] = useState<AdoptionRow[]>([]);
  const [platformStaff, setPlatformStaff] = useState<StaffAccount[]>([]);
  const [stagePayments, setStagePayments] = useState<StagePaymentRow[]>([]);

  const refreshBulkJob = useCallback(async (jobId: string) => {
    const r = await api.get<{ ok: true; job: BulkJob } | { ok: false; error: string }>(`/api/panel/bulk/jobs/${jobId}`);
    if (r.ok) setBulkJob(r.job);
  }, []);
  const [financials, setFinancials] = useState<FinancialSummary | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [periodDays, setPeriodDays] = useState(30);
  const [queueTasks, setQueueTasks] = useState<QueueTask[]>([]);
  const [digestSettings, setDigestSettings] = useState<DigestSettings | null>(null);

  const say = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);

  const loadPortfolio = useCallback(async (days: number) => {
    const r = await api.get<{ ok: true; portfolio: PortfolioSummary } | { ok: false; error: string }>(`/api/panel/portfolio?days=${days}`);
    if (r.ok) setPortfolio(r.portfolio);
  }, []);

  const loadAll = useCallback(async () => {
    const [p, c, sd, cy, eq, sm, sh, cl, tf, sb, ss, br, fin, qt, ds, sp, ps, ad, nw, ma] = await Promise.all([
      isAdminRef.current
        ? api.get<{ ok: true; pending: PendingAccount[] } | { ok: false; error: string }>('/api/admin/accounts/pending')
        : Promise.resolve({ ok: false as const, error: 'нет права' }),
      api.get<{ ok: true; checklists: ChecklistDef[] }>('/api/panel/checklists'),
      api.get<{ ok: true; stages: StageDraft[] }>('/api/panel/stage-docs'),
      api.get<{ ok: true; cycle: CycleMasterDraft | null }>('/api/panel/cycle'),
      api.get<{ ok: true; types: EquipTypeDraft[] }>('/api/panel/equip-types'),
      api.get<{ ok: true; rows: SummaryRowDraft[] }>('/api/panel/summary-master'),
      api.get<{ ok: true; items: SecondHandItem[] } | { ok: false; error: string }>('/api/second-hand/pending'),
      api.get<{ ok: true; clients: RichClientRow[] } | { ok: false; error: string }>('/api/panel/clients'),
      api.get<{ ok: true; tariffs: TariffDraft[] }>('/api/panel/tariffs'),
      api.get<{ ok: true; subscriptions: SubscriptionRow[] } | { ok: false; error: string }>('/api/panel/subscriptions'),
      api.get<{ ok: true; summary: SubscriptionSummary } | { ok: false; error: string }>('/api/panel/subscriptions/summary'),
      api.get<{ ok: true; reports: BulkReport[] } | { ok: false; error: string }>('/api/panel/bulk/reports'),
      api.get<{ ok: true; financials: FinancialSummary } | { ok: false; error: string }>('/api/panel/financials'),
      api.get<{ ok: true; tasks: QueueTask[] } | { ok: false; error: string }>('/api/panel/queue'),
      api.get<{ ok: true; settings: DigestSettings } | { ok: false; error: string }>('/api/panel/queue/digest-settings'),
      api.get<{ ok: true; payments: StagePaymentRow[] } | { ok: false; error: string }>('/api/panel/stage-payments'),
      isAdminRef.current
        ? api.get<{ ok: true; accounts: StaffAccount[] } | { ok: false; error: string }>('/api/admin/accounts')
        : Promise.resolve({ ok: false as const, error: 'нет права' }),
      api.get<{ ok: true; report: AdoptionRow[] } | { ok: false; error: string }>('/api/panel/standard/adoption'),
      isAdminRef.current
        ? api.get<{ ok: true; networks: NetworkRow[] } | { ok: false; error: string }>('/api/admin/networks')
        : Promise.resolve({ ok: false as const, error: 'нет права' }),
      isAdminRef.current
        ? api.get<{ ok: true; assignments: ManagerAssignmentRow[] } | { ok: false; error: string }>('/api/admin/manager-assignments')
        : Promise.resolve({ ok: false as const, error: 'нет права' }),
    ]);
    if (p.ok) setPending(p.pending);
    if (c.ok) setChecklists(c.checklists);
    if (sd.ok) setStages(sd.stages);
    if (cy.ok) setCycle(cy.cycle);
    if (eq.ok) setEquipTypes(eq.types);
    if (sm.ok) setSummaryRows(sm.rows);
    if (sh.ok) setSecondHand(sh.items);
    if (cl.ok) setClients(cl.clients);
    if (tf.ok) setTariffs(tf.tariffs);
    if (sb.ok) setSubscriptions(sb.subscriptions);
    if (ss.ok) setSubscriptionSummary(ss.summary);
    if (br.ok) setBulkReports(br.reports);
    if (fin.ok) setFinancials(fin.financials);
    if (qt.ok) setQueueTasks(qt.tasks);
    if (ds.ok) setDigestSettings(ds.settings);
    if (sp.ok) setStagePayments(sp.payments);
    setPlatformStaff(ps.ok ? ps.accounts : []);
    setAdoption(ad.ok ? ad.report : []);
    setNetworks(nw.ok ? nw.networks : []);
    setManagerAssignments(ma.ok ? ma.assignments : []);
    await loadPortfolio(periodDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPortfolio]);

  useEffect(() => {
    (async () => {
      const r = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session');
      const ok = r.ok && r.session && allowedRoles.includes(r.session.role);
      setSession(ok ? r.session : null);
      if (ok && r.session) { isAdminRef.current = r.session.role === 'platform_admin'; setTab(isAdminRef.current ? 'accounts' : 'clients'); }
      setReady(true);
      if (ok) await loadAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll]);

  function changePeriod(days: number) {
    setPeriodDays(days);
    void loadPortfolio(days);
  }

  async function doLogin() {
    if (!aInn.trim() || !aLogin.trim() || !aPass) {
      setAuthError('Введите ИНН, логин и пароль');
      return;
    }
    const r = await api.post<{ ok: true; needOtp?: boolean; via?: string } | { ok: false; error: string }>('/api/auth/login', { inn: aInn, login: aLogin, password: aPass });
    if (!r.ok) {
      setAuthError(r.error);
      return;
    }
    if (r.needOtp) { setAuthError(''); setOtpVia(r.via ?? 'sms'); return; }
    await finishLogin();
  }

  async function finishLogin() {
    setOtpVia(null);
    const s = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session');
    if (!s.ok || !s.session || !allowedRoles.includes(s.session.role)) {
      await api.post('/api/auth/logout');
      setAuthError(`Эта учётная запись не открывает «${heading}».`);
      return;
    }
    setSession(s.session);
    isAdminRef.current = s.session.role === 'platform_admin';
    setTab(isAdminRef.current ? 'accounts' : 'clients');
    setAuthError('');
    setAPass('');
    await loadAll();
  }

  async function doLogout() {
    await api.post('/api/auth/logout');
    setSession(null);
  }

  if (!ready) return null;

  if (!session) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px 18px' }}>
        <div style={{ width: '100%', maxWidth: 400, background: 'var(--bg-card)', border: '1px solid var(--border-1)', borderRadius: 16, padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-caption)' }}>Контур 785</div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{heading}</div>
          </div>
          {otpVia ? <OtpStep via={otpVia} onVerified={finishLogin} onBack={() => setOtpVia(null)} /> : authMode === 'reset' ? <ResetPasswordForm onBack={() => setAuthMode('login')} /> : (
            <>
              {authError && <div style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, fontWeight: 700, color: 'var(--error)' }}>{authError}</div>}
              <input value={aInn} onChange={(e) => setAInn(e.target.value)} placeholder="ИНН компании" style={{ ...inputStyle, fontFamily: 'var(--font-mono)', padding: '12px 13px', fontSize: 15 }} />
              <input value={aLogin} onChange={(e) => setALogin(e.target.value)} placeholder="Логин" style={{ ...inputStyle, padding: '12px 13px', fontSize: 15 }} />
              <input type="password" value={aPass} onChange={(e) => setAPass(e.target.value)} placeholder="Пароль" style={{ ...inputStyle, padding: '12px 13px', fontSize: 15 }} />
              <button onClick={doLogin} className="k785-tap-target" style={{ ...primaryBtn, padding: 14, fontSize: 15 }}>Войти</button>
              <button onClick={() => setAuthMode('reset')} style={authLinkBtn}>Забыли пароль?</button>
            </>
          )}
          <Link href="/" style={{ fontSize: 12.5, fontWeight: 700 }}>← на главную</Link>
        </div>
      </div>
    );
  }

  const canManageRoles = session.role === 'platform_admin';
  const canPublish = session.role === 'methodist' || session.role === 'platform_admin';
  const canConfirmMoney = session.role === 'sales_manager' || session.role === 'sales_head' || session.role === 'platform_admin';
  const canAcceptStage = ['platform_admin', 'methodist', 'sales_manager', 'sales_head'].includes(session.role);
  const canManageMoney = session.role === 'sales_manager' || session.role === 'sales_head' || session.role === 'platform_admin';
  const canManageMethodology = session.role === 'methodist' || session.role === 'platform_admin';
  const canAddClinic = canManageMoney;
  const activeQueueCount = queueTasks.filter((t) => t.state === 'new' || t.state === 'in_progress').length;

  const tabs: { key: Tab; label: string }[] = [
    ...(canManageRoles ? [{ key: 'accounts' as Tab, label: `Заявки на доступ · ${pending.length}` }, { key: 'networks' as Tab, label: `Сети клиник · ${networks.length}` }, { key: 'managers' as Tab, label: 'Ответственные менеджеры' }] : []),
    { key: 'checklists', label: `Чек-листы · ${checklists.length}` },
    { key: 'stages', label: 'Каталог этапов' },
    { key: 'cycle', label: 'Годовой цикл' },
    { key: 'equip', label: 'Типы оборудования' },
    { key: 'summary', label: 'Сводный отчёт' },
    { key: 'tariffs', label: `Тарифы · ${tariffs.length}` },
    { key: 'subscriptions', label: `Подписки · ${subscriptions.length}` },
    { key: 'payments', label: `Оплата этапов · ${stagePayments.filter((r) => r.payment.status === 'pending' || !r.payment.accepted).length}` },
    { key: 'grants', label: 'Выдача документов' },
    { key: 'adoption', label: `Внедрение стандарта · ${adoption.reduce((n, r) => n + r.pending, 0)}` },
    { key: 'bulk', label: 'Массовые операции' },
    { key: 'queue', label: `Очередь работы · ${activeQueueCount}` },
    { key: 'secondhand', label: `Вторая рука · ${secondHand.length}` },
    { key: 'clients', label: `Дашборд и клиенты · ${clients.length}` },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)' }}>
      <div style={{ background: 'var(--sidebar-bg)', color: 'var(--sidebar-text)', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ marginRight: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.7 }}>{heading}</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{session.fio} · {session.role}</div>
        </div>
        <button onClick={() => setShow2fa(true)} className="k785-tap-target" style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid #2c4442', background: 'transparent', color: 'var(--sidebar-text)', fontSize: 12, fontWeight: 700 }}>{session.twoFactor ? '2FA: включена' : 'Включить 2FA'}</button>
        <button onClick={() => setShowPw(true)} className="k785-tap-target" style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid #2c4442', background: 'transparent', color: 'var(--sidebar-text)', fontSize: 12, fontWeight: 700 }}>Сменить пароль</button>
        <button onClick={doLogout} className="k785-tap-target" style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid #2c4442', background: 'transparent', color: 'var(--sidebar-text)', fontSize: 12, fontWeight: 700 }}>Выйти</button>
      </div>

      <div style={{ padding: '18px clamp(12px, 4vw, 22px) 40px', maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className="k785-tap-target"
              style={{ padding: '9px 14px', borderRadius: 8, background: tab === t.key ? 'var(--text-primary)' : 'var(--bg-card)', color: tab === t.key ? '#fff' : 'var(--text-primary)', border: `1px solid ${tab === t.key ? 'var(--text-primary)' : 'var(--border-1)'}`, fontSize: 12.5, fontWeight: 700 }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'networks' && (
          <NetworksTab networks={networks}
            onCreate={async (name, headInn) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/admin/networks', { name, headInn });
              if (!r.ok) { say(r.error); return false; }
              await loadAll(); say('Сеть создана'); return true;
            }}
            onAddMember={async (id, inn) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/admin/networks/${id}/members`, { inn });
              if (!r.ok) { say(r.error); return false; }
              await loadAll(); say('Клиника добавлена в сеть'); return true;
            }}
            onRemoveMember={async (id, inn) => {
              const r = await api.del<{ ok: true } | { ok: false; error: string }>(`/api/admin/networks/${id}/members/${inn}`);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Клиника убрана из сети');
            }}
            onRemove={async (id) => {
              const r = await api.del<{ ok: true } | { ok: false; error: string }>(`/api/admin/networks/${id}`);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Сеть удалена');
            }}
          />
        )}

        {tab === 'managers' && (
          <ManagersTab assignments={managerAssignments} staff={platformStaff}
            onSave={async (managerId, inns) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>(`/api/admin/manager-assignments/${managerId}`, { inns });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say(inns.length ? 'Закрепление сохранено' : 'Закрепление снято — менеджер снова видит все клиники');
            }}
          />
        )}

        {tab === 'accounts' && (
          <AccountsTab pending={pending} canManageRoles={canManageRoles} staff={platformStaff} myId={session.accountId}
            onElevate={async (accountId, newRole) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/admin/role-elevation/request', { accountId, newRole });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Запрос на смену роли отправлен — его подтверждает другой администратор (вкладка «Вторая рука»)');
            }}
            onApprove={async (id, role) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/admin/accounts/${id}/approve`, { role });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка подтверждена');
            }}
            onReject={async (id) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/admin/accounts/${id}/reject`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка отклонена');
            }}
          />
        )}

        {tab === 'checklists' && (
          <ChecklistsTab checklists={checklists} canPublish={canPublish}
            onPublish={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/checklists' + pilotQs(), next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию отправлена — нужно подтверждение другого сотрудника (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'stages' && (
          <StageCatalogForm stages={stages} canPublish={canPublish}
            onPublish={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/stage-docs' + pilotQs(), next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию отправлена — нужно подтверждение другого сотрудника (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'cycle' && (
          <CycleMasterForm cycle={cycle} canPublish={canPublish}
            onPublish={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/cycle' + pilotQs(), next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию отправлена — нужно подтверждение другого сотрудника (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'equip' && (
          <EquipTypesForm types={equipTypes} canPublish={canPublish}
            onPublish={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/equip-types' + pilotQs(), next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию отправлена — нужно подтверждение другого сотрудника (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'summary' && (
          <SummaryMasterForm rows={summaryRows} canPublish={canPublish}
            onPublish={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/summary-master' + pilotQs(), next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию отправлена — нужно подтверждение другого сотрудника (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'tariffs' && (
          <TariffsForm tariffs={tariffs} canManage={canManageMoney}
            onSaveDraft={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/tariffs', next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Черновик тарифов сохранён');
            }}
            onPublish={async (key) => {
              const r = await api.post<{ ok: true; secondHandRequest?: unknown } | { ok: false; error: string }>(`/api/panel/tariffs/${encodeURIComponent(key)}/publish`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию тарифа отправлена — подтверждает другой сотрудник (вкладка «Вторая рука»)');
            }}
            onDelete={async (key) => {
              const r = await api.post<{ ok: true; secondHandRequest?: unknown } | { ok: false; error: string }>(`/api/panel/tariffs/${encodeURIComponent(key)}/delete`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на удаление тарифа отправлена — подтверждает другой сотрудник (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'subscriptions' && (
          <SubscriptionsPanel rows={subscriptions} tariffs={tariffs} summary={subscriptionSummary} canManage={canManageMoney}
            onAssign={async (inn, tariffKey, days, trial) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/panel/subscriptions/${inn}/assign`, { tariffKey, days, trial });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Тариф назначен клинике');
            }}
            onRenew={async (inn, days) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/panel/subscriptions/${inn}/renew`, { days });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Подписка продлена');
            }}
            onCancel={async (inn) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/panel/subscriptions/${inn}/cancel`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Подписка отменена');
            }}
          />
        )}

        {tab === 'bulk' && (
          <BulkOperationsPanel clients={clients} canMoney={canManageMoney} canMethodology={canManageMethodology} reports={bulkReports}
            activeJob={bulkJob} onRefreshJob={() => bulkJob && refreshBulkJob(bulkJob.id)}
            onPrepare={async (action, inns) => {
              const r = await api.post<{ ok: true; label: string; undoable: boolean; rows: BulkPreviewRow[] } | { ok: false; error: string }>(`/api/panel/bulk/${action}/prepare`, { tenantInns: inns });
              if (!r.ok) { say(r.error); return null; }
              return { label: r.label, undoable: r.undoable, rows: r.rows };
            }}
            onCommit={async (action, inns) => {
              const r = await api.post<{ ok: true; report?: BulkReport; secondHandRequest?: unknown } | { ok: false; error: string }>(`/api/panel/bulk/${action}/commit`, { tenantInns: inns });
              if (!r.ok) { say(r.error); return; }
              if (r.secondHandRequest) say('Пачка больше 20 клиник — запрос ушёл на подтверждение второй рукой (вкладка «Вторая рука»)');
              else say(`Применено к ${r.report?.done.length ?? 0} клиникам`);
              await loadAll();
            }}
            onUndo={async (reportId) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/panel/bulk/reports/${reportId}/undo`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Операция откачена');
            }}
          />
        )}

        {tab === 'clients' && (
          <ClientCatalogTab
            clients={clients} financials={financials} portfolio={portfolio}
            periodDays={periodDays} onPeriodChange={changePeriod}
            canAddClinic={canAddClinic}
            onAddClinic={async (input) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/panel/clients', input);
              if (!r.ok) { say(r.error); return false; }
              await loadAll(); say('Клиника добавлена');
              return true;
            }}
          />
        )}

        {tab === 'queue' && (
          <WorkQueueTab tasks={queueTasks} digestSettings={digestSettings}
            onTake={async (id) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/panel/queue/${id}/take`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll();
            }}
            onPostpone={async (id) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/panel/queue/${id}/postpone`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Задача отложена на 3 дня');
            }}
            onClose={async (id) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/panel/queue/${id}/close`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Задача закрыта');
            }}
            onSaveDigestSettings={async (recipientEmail, schedule) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/queue/digest-settings', { recipientEmail, schedule });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Настройки сводки сохранены');
            }}
            onSendDigestNow={async () => {
              const r = await api.post<{ ok: true; taskCount: number } | { ok: false; error: string }>('/api/panel/queue/digest/send', {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say(`Дайджест отправлен · открытых задач: ${r.taskCount}`);
            }}
          />
        )}

        {tab === 'payments' && (
          <PaymentsTab canConfirm={canConfirmMoney} canAccept={canAcceptStage} rows={stagePayments}
            onConfirm={async (inn, code) => {
              const r = await api.post<{ ok: true; payment?: unknown; secondHandRequest?: unknown } | { ok: false; error: string }>(`/api/panel/stage-payments/${inn}/${code}/confirm`, {});
              if (!r.ok) { say(r.error); return; }
              if (r.secondHandRequest) say('Сумма от 100 000 ₽ — запрос ушёл на подтверждение второй рукой (вкладка «Вторая рука»)');
              else say('Оплата подтверждена');
              await loadAll();
            }}
            onAccept={async (inn, code) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/panel/stage-payments/${inn}/${code}/accept`, {});
              if (!r.ok) { say(r.error); return; }
              say('Этап принят — следующий этап разблокирован в кабинете клиники');
              await loadAll();
            }}
          />
        )}

        {tab === 'adoption' && (
          <AdoptionTab rows={adoption} pilotInns={pilotInns} setPilotInns={setPilotInns} canRelease={canPublish}
            onRelease={async (catalog, no) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/panel/standard/${catalog}/${no}/release`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Редакция выпущена для всех клиник');
            }}
          />
        )}

        {tab === 'grants' && (
          <DocumentGrantsTab clients={clients} stages={stages} payments={stagePayments}
            onLoadGrants={async (inn) => {
              const r = await api.get<{ ok: true; grants: Record<string, { paid: boolean; byRole: string | null }> } | { ok: false; error: string }>(`/api/tenants/${inn}/documents/grants`);
              return r.ok ? r.grants : {};
            }}
            onGrant={async (inn, stage, name, paid) => {
              const r = await api.post<{ ok: true; secondHandRequest?: unknown } | { ok: false; error: string }>('/api/documents/grant', { tenantInn: inn, stage: String(stage), code: name, name, paid });
              if (!r.ok) { say(r.error); return; }
              say(r.secondHandRequest ? 'Выдача без оплаты — запрос ушёл на подтверждение второй рукой (вкладка «Вторая рука»)' : 'Документ выдан клинике');
              await loadAll();
            }}
            onRevoke={async (inn, stage, name) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/documents/revoke', { tenantInn: inn, stage: String(stage), code: name, name });
              if (!r.ok) { say(r.error); return; }
              say('Выдача документа отозвана');
            }}
          />
        )}

        {tab === 'secondhand' && (
          <SecondHandTab items={secondHand}
            onConfirm={async (id) => {
              const r = await api.post<{ ok: true; result?: { jobId?: string } } | { ok: false; error: string }>(`/api/second-hand/${id}/confirm`, {});
              if (!r.ok) { say(r.error); return; }
              if (r.result?.jobId) {
                await refreshBulkJob(r.result.jobId);
                say('Подтверждено — пачка применяется в фоне, статус смотрите во вкладке «Массовые операции»');
              } else {
                say('Операция подтверждена');
              }
              await loadAll();
            }}
            onReject={async (id) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/second-hand/${id}/reject`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Операция отклонена');
            }}
          />
        )}
      </div>

      {showPw && <ChangePasswordDialog onClose={() => setShowPw(false)} />}
      {show2fa && <TwoFactorDialog state={session} onClose={() => setShow2fa(false)} onChanged={async () => { const r = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session'); if (r.ok && r.session) setSession(r.session); }} />}
      {session.mustChange && <ChangePasswordDialog forced onClose={() => undefined} onChanged={async () => { const r = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session'); if (r.ok && r.session) { setSession(r.session); await loadAll(); } }} />}

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', maxWidth: 560, background: 'var(--text-primary)', color: '#fff', padding: '12px 18px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, boxShadow: 'var(--shadow-toast)', zIndex: 40 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function AccountsTab({ pending, canManageRoles, staff, myId, onElevate, onApprove, onReject }: {
  pending: PendingAccount[]; canManageRoles: boolean; staff: StaffAccount[]; myId?: string; onElevate: (accountId: string, role: string) => void;
  onApprove: (id: string, role: string) => void; onReject: (id: string) => void;
}) {
  const [target, setTarget] = useState<Record<string, string>>({});
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {canManageRoles && staff.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>Сотрудники платформы</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>
            Смена роли — необратимая операция второй руки: запрос подтверждает другой администратор.
          </div>
          {staff.map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid var(--border-3)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{a.fio || a.login} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>· {ROLE_LABELS[a.role] ?? a.role}{a.id === myId ? ' · это вы' : ''}</span></div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select value={target[a.id] ?? a.role} onChange={(e) => setTarget((m) => ({ ...m, [a.id]: e.target.value }))} style={{ ...inputStyle, width: 'auto', maxWidth: '100%' }} aria-label={`Новая роль: ${a.fio || a.login}`}>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button disabled={(target[a.id] ?? a.role) === a.role} onClick={() => onElevate(a.id, target[a.id] ?? a.role)} style={{ ...outlineBtn, opacity: (target[a.id] ?? a.role) === a.role ? 0.5 : 1 }}>Запросить смену роли</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {pending.length === 0 && <EmptyState text="Открытых заявок нет." />}
      {pending.map((p) => (
        <AccountRow key={p.id} account={p} canManageRoles={canManageRoles} onApprove={onApprove} onReject={onReject} />
      ))}
    </div>
  );
}

function AccountRow({ account, canManageRoles, onApprove, onReject }: {
  account: PendingAccount; canManageRoles: boolean; onApprove: (id: string, role: string) => void; onReject: (id: string) => void;
}) {
  const [role, setRole] = useState(account.requestedRole || 'methodist');
  return (
    <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{account.fio} · {account.login}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>ИНН {account.inn} · запрошена роль: {account.requestedRole || 'не указана'}</div>
      </div>
      {canManageRoles && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inputStyle, width: 'auto', maxWidth: '100%' }}>
            <option value="methodist">методист</option>
            <option value="sales_manager">менеджер по продажам</option>
            <option value="sales_head">руководитель продаж</option>
            <option value="platform_admin">администратор платформы</option>
          </select>
          <button onClick={() => onApprove(account.id, role)} style={primaryBtn}>Подтвердить</button>
          <button onClick={() => onReject(account.id)} style={outlineBtn}>Отклонить</button>
        </div>
      )}
    </div>
  );
}

function ChecklistsTab({ checklists, canPublish, onPublish }: { checklists: ChecklistDef[]; canPublish: boolean; onPublish: (next: ChecklistDef[]) => void }) {
  const [draft, setDraft] = useState<ChecklistDef[]>(checklists);
  useEffect(() => setDraft(checklists), [checklists]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {draft.map((c, i) => (
        <div key={i} style={cardStyle}>
          <input
            value={c.name}
            disabled={!canPublish}
            onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            style={{ ...inputStyle, fontWeight: 800, marginBottom: 8 }}
          />
          <textarea
            value={c.items.join('\n')}
            disabled={!canPublish}
            onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, items: e.target.value.split('\n').filter(Boolean) } : x)))}
            placeholder="Пункты чек-листа, по одному на строку"
            style={{ ...inputStyle, minHeight: 100, fontFamily: 'inherit' }}
          />
          {canPublish && (
            <button onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} style={{ ...outlineBtn, marginTop: 8 }}>Удалить чек-лист</button>
          )}
        </div>
      ))}
      {canPublish && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setDraft((d) => d.concat([{ name: 'Новый чек-лист', items: [] }]))} style={outlineBtn}>+ чек-лист</button>
          <button onClick={() => onPublish(draft)} style={primaryBtn}>Опубликовать каталог</button>
        </div>
      )}
    </div>
  );
}

function ManagersTab({ assignments, staff, onSave }: {
  assignments: ManagerAssignmentRow[]; staff: StaffAccount[]; onSave: (managerId: string, inns: string[]) => void;
}) {
  const managers = staff.filter((s) => s.role === 'sales_manager');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const current = (id: string) => draft[id] ?? assignments.find((a) => a.managerId === id)?.clinics.map((c) => c.inn).join(', ') ?? '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.5 }}>
        Без закрепления менеджер по продажам видит каталог клиентов, финансы и портфель по всей платформе — как раньше.
        Указав список ИНН через запятую, вы сужаете его обзор и право выдавать документы только этими клиниками;
        пустое поле снимает ограничение целиком.
      </div>
      {managers.length === 0 && <EmptyState text="Среди сотрудников платформы нет менеджеров по продажам." />}
      {managers.map((m) => (
        <div key={m.id} style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>{m.fio || m.login}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>
            {assignments.find((a) => a.managerId === m.id)?.clinics.length ? `закреплено клиник: ${assignments.find((a) => a.managerId === m.id)!.clinics.length}` : 'ограничений нет — видит все клиники'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={current(m.id)} onChange={(e) => setDraft((d) => ({ ...d, [m.id]: e.target.value }))} placeholder="ИНН клиник через запятую" style={{ ...inputStyle, fontFamily: 'var(--font-mono)', flex: '1 1 260px' }} />
            <button onClick={() => onSave(m.id, current(m.id).split(',').map((s) => s.trim()).filter(Boolean))} style={primaryBtn}>Сохранить</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function NetworksTab({ networks, onCreate, onAddMember, onRemoveMember, onRemove }: {
  networks: NetworkRow[]; onCreate: (name: string, headInn: string) => Promise<boolean>; onAddMember: (id: string, inn: string) => Promise<boolean>;
  onRemoveMember: (id: string, inn: string) => void; onRemove: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [headInn, setHeadInn] = useState('');
  const [addInn, setAddInn] = useState<Record<string, string>>({});
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.5 }}>
        Сеть объединяет клиники под одной головной: данные клиник остаются раздельными, но собственные чек-листы сети (их ведёт администратор головной клиники)
        ложатся поверх эталона методиста у всех участниц. Клиника состоит не более чем в одной сети.
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Новая сеть</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название сети" style={{ ...inputStyle, flex: '1 1 200px', width: 'auto' }} />
          <input value={headInn} onChange={(e) => setHeadInn(e.target.value)} placeholder="ИНН головной клиники" style={{ ...inputStyle, flex: '1 1 180px', width: 'auto', fontFamily: 'var(--font-mono)' }} />
          <button onClick={async () => { if (await onCreate(name, headInn)) { setName(''); setHeadInn(''); } }} style={primaryBtn}>Создать сеть</button>
        </div>
      </div>
      {networks.length === 0 && <EmptyState text="Сетей пока нет." />}
      {networks.map((n) => (
        <div key={n.id} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 13.5, fontWeight: 800 }}>{n.name} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>· клиник: {n.members.length}</span></div>
            <button onClick={() => { if (window.confirm(`Удалить сеть «${n.name}»? Клиники потеряют сетевые чек-листы.`)) onRemove(n.id); }} style={outlineBtn}>Удалить сеть</button>
          </div>
          <div style={{ marginTop: 8 }}>
            {n.members.map((m) => (
              <div key={m.inn} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border-3)', fontSize: 12, fontWeight: 600 }}>
                <span>{m.name} <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{m.inn}</span>{m.inn === n.headInn ? ' · головная' : ''}</span>
                {m.inn !== n.headInn && <button onClick={() => onRemoveMember(n.id, m.inn)} style={outlineBtn}>Убрать</button>}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={addInn[n.id] ?? ''} onChange={(e) => setAddInn((a) => ({ ...a, [n.id]: e.target.value }))} placeholder="ИНН клиники для добавления" aria-label={`ИНН для сети ${n.name}`} style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
            <button onClick={async () => { if (await onAddMember(n.id, addInn[n.id] ?? '')) setAddInn((a) => ({ ...a, [n.id]: '' })); }} style={outlineBtn}>Добавить</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdoptionTab({ rows, pilotInns, setPilotInns, canRelease, onRelease }: {
  rows: AdoptionRow[]; pilotInns: string; setPilotInns: (v: string) => void; canRelease: boolean; onRelease: (catalog: string, no: number) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const label = { current: 'на последней', pending: 'не отреагировала', declined: 'отказалась' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.5 }}>
        Кто на какой редакции эталона. Массовый отказ от редакции — сигнал переписать документ, а не давить на внедрение.
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Пилотный тираж</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>
          Ближайшие публикации каталогов уйдут ТОЛЬКО клиникам из списка (ИНН через запятую), остальные останутся на прежней редакции, пока вы не выпустите её для всех. Пусто — публикация для всех.
        </div>
        <input value={pilotInns} onChange={(e) => setPilotInns(e.target.value)} placeholder="ИНН пилотных клиник через запятую" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
      </div>
      {rows.length === 0 && <EmptyState text="Редакции ещё не выпускались — публикация каталога создаёт редакцию 1." />}
      {rows.map((r) => (
        <div key={r.catalog} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{r.label} · последняя ред. {r.latest}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>приняли: {r.accepted} · не отреагировали: {r.pending} · отказались: {r.declined}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {r.pilot && canRelease && <button onClick={() => onRelease(r.catalog, r.pilot!.no)} style={primaryBtn}>Выпустить ред. {r.pilot.no} для всех</button>}
              <button onClick={() => setOpen(open === r.catalog ? null : r.catalog)} style={outlineBtn}>{open === r.catalog ? 'Скрыть клиники' : 'По клиникам'}</button>
            </div>
          </div>
          {r.pilot && <div style={{ fontSize: 11.5, color: 'var(--warn)', fontWeight: 700, marginTop: 6 }}>Ред. {r.pilot.no} в пилоте: {r.pilot.inns.join(', ')}</div>}
          {open === r.catalog && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {r.tenants.map((t) => (
                <div key={t.inn} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 600, padding: '4px 0', borderBottom: '1px solid var(--border-3)' }}>
                  <span>{t.name} <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{t.inn}</span></span>
                  <span style={{ color: t.status === 'current' ? 'var(--accent-hover)' : t.status === 'declined' ? 'var(--error)' : 'var(--warn)' }}>ред. {t.adopted} · {label[t.status]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PaymentsTab({ canConfirm, canAccept, rows, onConfirm, onAccept }: {
  canConfirm: boolean; canAccept: boolean; rows: StagePaymentRow[]; onConfirm: (inn: string, code: number) => void; onAccept: (inn: string, code: number) => void;
}) {
  const [inn, setInn] = useState('');
  const [code, setCode] = useState('1');
  const [ainn, setAinn] = useState('');
  const [acode, setAcode] = useState('1');
  if (!canConfirm && !canAccept) return <EmptyState text="Подтверждение оплаты и приёмка этапа доступны сотрудникам платформы." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <StagePaymentsList rows={rows} canConfirm={canConfirm} canAccept={canAccept} onConfirm={onConfirm} onAccept={onAccept} />
      {canConfirm && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>Подтвердить оплату этапа по счёту</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>
            Клиника уже заказала этап в своём кабинете. Оплата от 100 000 ₽ уйдёт на подтверждение второй рукой.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={inn} onChange={(e) => setInn(e.target.value)} placeholder="ИНН клиники" style={{ ...inputStyle, flex: '1 1 200px', fontFamily: 'var(--font-mono)' }} />
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="№ этапа" style={{ ...inputStyle, flex: '0 1 100px' }} />
            <button onClick={() => { if (inn.trim()) onConfirm(inn.trim(), Number(code)); }} style={primaryBtn}>Подтвердить оплату</button>
          </div>
        </div>
      )}
      {canAccept && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>Принять этап (методист/платформа)</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>
            Приёмка — отдельный от оплаты факт: подтверждает, что работа по этапу выполнена. Следующий этап разблокируется в кабинете клиники только после приёмки текущего.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={ainn} onChange={(e) => setAinn(e.target.value)} placeholder="ИНН клиники" style={{ ...inputStyle, flex: '1 1 200px', fontFamily: 'var(--font-mono)' }} />
            <input value={acode} onChange={(e) => setAcode(e.target.value)} placeholder="№ этапа" style={{ ...inputStyle, flex: '0 1 100px' }} />
            <button onClick={() => { if (ainn.trim()) onAccept(ainn.trim(), Number(acode)); }} style={primaryBtn}>Принять этап</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SecondHandTab({ items, onConfirm, onReject }: { items: SecondHandItem[]; onConfirm: (id: string) => void; onReject: (id: string) => void }) {
  const typeLabel: Record<string, string> = {
    'role:elevate': 'Повышение роли',
    'money:confirm': 'Подтверждение крупной оплаты',
    'standard:publish': 'Публикация эталона',
    'tariff:publish': 'Публикация тарифов',
    'tariff:delete': 'Удаление тарифа',
    'bulk:clinics': 'Массовая операция по клиникам',
    'doc:grant-without-payment': 'Выдача документа без оплаты',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.length === 0 && <EmptyState text="Открытых запросов второй руки нет." />}
      {items.map((r) => (
        <div key={r.id} style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{typeLabel[r.type] || r.type}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>
            {r.tenantInn && `ИНН ${r.tenantInn} · `}запрошено {new Date(r.requestedAt).toLocaleString('ru-RU')}
          </div>
          <pre style={{ fontSize: 11, fontFamily: 'var(--font-mono)', background: 'var(--bg-app)', borderRadius: 7, padding: 8, marginTop: 6, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(r.payload, null, 2)}
          </pre>
          {r.canAct ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => onConfirm(r.id)} style={primaryBtn}>Подтвердить</button>
              <button onClick={() => onReject(r.id)} style={outlineBtn}>Отклонить</button>
            </div>
          ) : (
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-caption)', marginTop: 8 }}>
              Подтвердить может только другой сотрудник с нужным правом.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px dashed #cfd8d7', borderRadius: 12, padding: 24, textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.5 }}>
      {text}
    </div>
  );
}
