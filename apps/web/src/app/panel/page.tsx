'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  StageCatalogForm, CycleMasterForm, EquipTypesForm, SummaryMasterForm,
  type StageDraft, type CycleMasterDraft, type EquipTypeDraft, type SummaryRowDraft,
} from './catalogForms';
import {
  TariffsForm, SubscriptionsPanel, BulkOperationsPanel, FinancialSummaryCards,
  type TariffDraft, type SubscriptionRow, type BulkPreviewRow, type BulkReport, type FinancialSummary,
} from './salesForms';

/**
 * Панель платформы (README «Эталоны», «Дашборд»; SERVER.md §4 «вторая
 * рука»): публикация каталога чек-листов/этапов/годового цикла/типов
 * оборудования/сводного отчёта методистом — через вторую руку
 * (`standard:publish`), подтверждение и приёмка оплаты этапа, тарифы и
 * подписки клиник, массовые операции по каталогу клиентов с откатом,
 * финансовая сводка, заявки на доступ, вторая рука на все семь операций.
 */

interface SessionInfo {
  role: string;
  side: 'platform' | 'clinic';
  fio: string;
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

const ALLOWED_ROLES = ['platform_admin', 'methodist', 'sales_manager', 'sales_head'];
const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '14px 16px' };
const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border-1)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, width: '100%' };
const primaryBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' };
const outlineBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 7, border: '1px solid var(--border-1)', background: 'transparent', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };

interface ClientRow {
  inn: string;
  name: string;
  createdAt: string;
  staffCount: number;
  stagesPaid: number;
  openCapa: number;
}

type Tab = 'accounts' | 'checklists' | 'stages' | 'cycle' | 'equip' | 'summary' | 'tariffs' | 'subscriptions' | 'payments' | 'bulk' | 'secondhand' | 'clients';

export default function PlatformPanelPage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authError, setAuthError] = useState('');
  const [aInn, setAInn] = useState('');
  const [aLogin, setALogin] = useState('');
  const [aPass, setAPass] = useState('');
  const [tab, setTab] = useState<Tab>('accounts');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pending, setPending] = useState<PendingAccount[]>([]);
  const [checklists, setChecklists] = useState<ChecklistDef[]>([]);
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [cycle, setCycle] = useState<CycleMasterDraft | null>(null);
  const [equipTypes, setEquipTypes] = useState<EquipTypeDraft[]>([]);
  const [summaryRows, setSummaryRows] = useState<SummaryRowDraft[]>([]);
  const [secondHand, setSecondHand] = useState<SecondHandItem[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [tariffs, setTariffs] = useState<TariffDraft[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [bulkReports, setBulkReports] = useState<BulkReport[]>([]);
  const [financials, setFinancials] = useState<FinancialSummary | null>(null);

  const say = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);

  const loadAll = useCallback(async () => {
    const [p, c, sd, cy, eq, sm, sh, cl, tf, sb, br, fin] = await Promise.all([
      api.get<{ ok: true; pending: PendingAccount[] } | { ok: false; error: string }>('/api/admin/accounts/pending'),
      api.get<{ ok: true; checklists: ChecklistDef[] }>('/api/panel/checklists'),
      api.get<{ ok: true; stages: StageDraft[] }>('/api/panel/stage-docs'),
      api.get<{ ok: true; cycle: CycleMasterDraft | null }>('/api/panel/cycle'),
      api.get<{ ok: true; types: EquipTypeDraft[] }>('/api/panel/equip-types'),
      api.get<{ ok: true; rows: SummaryRowDraft[] }>('/api/panel/summary-master'),
      api.get<{ ok: true; items: SecondHandItem[] } | { ok: false; error: string }>('/api/second-hand/pending'),
      api.get<{ ok: true; clients: ClientRow[] } | { ok: false; error: string }>('/api/panel/clients'),
      api.get<{ ok: true; tariffs: TariffDraft[] }>('/api/panel/tariffs'),
      api.get<{ ok: true; subscriptions: SubscriptionRow[] } | { ok: false; error: string }>('/api/panel/subscriptions'),
      api.get<{ ok: true; reports: BulkReport[] } | { ok: false; error: string }>('/api/panel/bulk/reports'),
      api.get<{ ok: true; financials: FinancialSummary } | { ok: false; error: string }>('/api/panel/financials'),
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
    if (br.ok) setBulkReports(br.reports);
    if (fin.ok) setFinancials(fin.financials);
  }, []);

  useEffect(() => {
    (async () => {
      const r = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session');
      const ok = r.ok && r.session && ALLOWED_ROLES.includes(r.session.role);
      setSession(ok ? r.session : null);
      setReady(true);
      if (ok) await loadAll();
    })();
  }, [loadAll]);

  async function doLogin() {
    if (!aInn.trim() || !aLogin.trim() || !aPass) {
      setAuthError('Введите ИНН, логин и пароль');
      return;
    }
    const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/auth/login', { inn: aInn, login: aLogin, password: aPass });
    if (!r.ok) {
      setAuthError(r.error);
      return;
    }
    const s = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session');
    if (!s.ok || !s.session || !ALLOWED_ROLES.includes(s.session.role)) {
      await api.post('/api/auth/logout');
      setAuthError('Эта учётная запись не открывает панель платформы.');
      return;
    }
    setSession(s.session);
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
            <div style={{ fontSize: 19, fontWeight: 800 }}>Панель платформы</div>
          </div>
          {authError && <div style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, fontWeight: 700, color: 'var(--error)' }}>{authError}</div>}
          <input value={aInn} onChange={(e) => setAInn(e.target.value)} placeholder="ИНН компании" style={{ ...inputStyle, fontFamily: 'var(--font-mono)', padding: '12px 13px', fontSize: 15 }} />
          <input value={aLogin} onChange={(e) => setALogin(e.target.value)} placeholder="Логин" style={{ ...inputStyle, padding: '12px 13px', fontSize: 15 }} />
          <input type="password" value={aPass} onChange={(e) => setAPass(e.target.value)} placeholder="Пароль" style={{ ...inputStyle, padding: '12px 13px', fontSize: 15 }} />
          <button onClick={doLogin} className="k785-tap-target" style={{ ...primaryBtn, padding: 14, fontSize: 15 }}>Войти</button>
          <a href="/" style={{ fontSize: 12.5, fontWeight: 700 }}>← на главную</a>
        </div>
      </div>
    );
  }

  const canManageRoles = session.role === 'platform_admin';
  const canPublish = session.role === 'methodist' || session.role === 'platform_admin';
  const canConfirmMoney = session.role === 'sales_manager' || session.role === 'sales_head' || session.role === 'platform_admin';
  const canAcceptStage = ALLOWED_ROLES.includes(session.role);
  const canManageMoney = session.role === 'sales_manager' || session.role === 'sales_head' || session.role === 'platform_admin';
  const canManageMethodology = session.role === 'methodist' || session.role === 'platform_admin';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'accounts', label: `Заявки на доступ · ${pending.length}` },
    { key: 'checklists', label: `Чек-листы · ${checklists.length}` },
    { key: 'stages', label: 'Каталог этапов' },
    { key: 'cycle', label: 'Годовой цикл' },
    { key: 'equip', label: 'Типы оборудования' },
    { key: 'summary', label: 'Сводный отчёт' },
    { key: 'tariffs', label: `Тарифы · ${tariffs.length}` },
    { key: 'subscriptions', label: `Подписки · ${subscriptions.length}` },
    { key: 'payments', label: 'Оплата этапов' },
    { key: 'bulk', label: 'Массовые операции' },
    { key: 'secondhand', label: `Вторая рука · ${secondHand.length}` },
    { key: 'clients', label: `Дашборд и клиенты · ${clients.length}` },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)' }}>
      <div style={{ background: 'var(--sidebar-bg)', color: 'var(--sidebar-text)', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginRight: 'auto' }}>{session.fio} · {session.role}</div>
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

        {tab === 'accounts' && (
          <AccountsTab pending={pending} canManageRoles={canManageRoles}
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
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/checklists', next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию отправлена — нужно подтверждение другого сотрудника (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'stages' && (
          <StageCatalogForm stages={stages} canPublish={canPublish}
            onPublish={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/stage-docs', next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию отправлена — нужно подтверждение другого сотрудника (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'cycle' && (
          <CycleMasterForm cycle={cycle} canPublish={canPublish}
            onPublish={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/cycle', next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию отправлена — нужно подтверждение другого сотрудника (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'equip' && (
          <EquipTypesForm types={equipTypes} canPublish={canPublish}
            onPublish={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/equip-types', next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка на публикацию отправлена — нужно подтверждение другого сотрудника (вкладка «Вторая рука»)');
            }}
          />
        )}

        {tab === 'summary' && (
          <SummaryMasterForm rows={summaryRows} canPublish={canPublish}
            onPublish={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/panel/summary-master', next);
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
          <SubscriptionsPanel rows={subscriptions} tariffs={tariffs} canManage={canManageMoney}
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

        {tab === 'clients' && <ClientsTab clients={clients} financials={financials} />}

        {tab === 'payments' && (
          <PaymentsTab canConfirm={canConfirmMoney} canAccept={canAcceptStage}
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

        {tab === 'secondhand' && (
          <SecondHandTab items={secondHand}
            onConfirm={async (id) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/second-hand/${id}/confirm`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Операция подтверждена');
            }}
            onReject={async (id) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/second-hand/${id}/reject`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Операция отклонена');
            }}
          />
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', maxWidth: 560, background: 'var(--text-primary)', color: '#fff', padding: '12px 18px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, boxShadow: 'var(--shadow-toast)', zIndex: 40 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function AccountsTab({ pending, canManageRoles, onApprove, onReject }: {
  pending: PendingAccount[]; canManageRoles: boolean; onApprove: (id: string, role: string) => void; onReject: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setDraft((d) => d.concat([{ name: 'Новый чек-лист', items: [] }]))} style={outlineBtn}>+ чек-лист</button>
          <button onClick={() => onPublish(draft)} style={primaryBtn}>Опубликовать каталог</button>
        </div>
      )}
    </div>
  );
}

function PaymentsTab({ canConfirm, canAccept, onConfirm, onAccept }: {
  canConfirm: boolean; canAccept: boolean; onConfirm: (inn: string, code: number) => void; onAccept: (inn: string, code: number) => void;
}) {
  const [inn, setInn] = useState('');
  const [code, setCode] = useState('1');
  const [ainn, setAinn] = useState('');
  const [acode, setAcode] = useState('1');
  if (!canConfirm && !canAccept) return <EmptyState text="Подтверждение оплаты и приёмка этапа доступны сотрудникам платформы." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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

function ClientsTab({ clients, financials }: { clients: ClientRow[]; financials: FinancialSummary | null }) {
  const [q, setQ] = useState('');
  const filtered = clients.filter((c) => !q.trim() || c.inn.includes(q.trim()) || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FinancialSummaryCards financials={financials} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по ИНН или названию" style={inputStyle} />
      {filtered.length === 0 && <EmptyState text="Клиник пока нет." />}
      {filtered.map((c) => (
        <div key={c.inn} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{c.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>ИНН {c.inn} · с {c.createdAt}</div>
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 11.5, fontWeight: 700 }}>
            <span>Сотрудников: {c.staffCount}</span>
            <span>Оплачено этапов: {c.stagesPaid}</span>
            <span style={{ color: c.openCapa > 0 ? 'var(--error)' : 'var(--text-muted)' }}>Открытых CAPA: {c.openCapa}</span>
          </div>
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
