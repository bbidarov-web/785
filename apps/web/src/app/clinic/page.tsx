'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  BranchesTab, CycleTab, EquipmentTab, SummaryTab, SelfAuditTab, ProfileTab, InventoryTab,
  type Branch, type CycleDirectionView, type EquipmentPosition, type EquipmentTypeDef, type EquipmentFormRow,
  type SummaryRow, type SelfAuditRunView, type ClinicProfile, type InventoryRow, type InventorySummary,
} from './extraTabs';

/**
 * Личный кабинет ВКК — первая часть (README «Сотрудники и матрица
 * ответственных», «План проверок», «Нарушения и CAPA»). Полный экран
 * прототипа (10 400 строк) не перенесён — см. apps/api/src/clinic/*.ts и
 * README «Известные ограничения» про годовой цикл и филиалы.
 */

interface SessionInfo {
  role: string;
  side: 'platform' | 'clinic';
  fio: string;
  inn: string;
}

interface StaffMember {
  fio: string;
  pos: string;
}

interface PendingAccount {
  id: string;
  login: string;
  fio: string;
  phone: string | null;
  email: string | null;
  requestedRole: string | null;
  createdAt: string;
}

const CLINIC_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'clinic_admin', label: 'Администратор клиники' },
  { value: 'vkk_lead', label: 'Ответственный за ВКК' },
  { value: 'nurse', label: 'Медсестра / исполнитель' },
  { value: 'auditor', label: 'Аудитор' },
  { value: 'observer', label: 'Наблюдатель' },
];

interface PlanItem {
  id: string;
  name?: string;
  dir?: string;
  check?: string;
  object?: string;
  branch?: string;
  kind?: string;
  date?: string;
  who?: string;
}

interface Finding {
  planId: string;
  itemIndex: number;
  auditName: string;
  object: string;
  text: string;
  comment: string;
}

interface StagePayment {
  status: 'none' | 'pending' | 'paid';
  amount: number;
  confirmedAt: string | null;
  accepted: boolean;
  offerAccepted: boolean;
}

interface StageDocView {
  name: string;
  granted: boolean;
}

interface StageBlockView {
  key: string;
  num: string;
  name: string;
  docs: StageDocView[];
}

interface StageView {
  code: number;
  name: string;
  price: number;
  offerText: string | null;
  offerFile: string | null;
  payment: StagePayment;
  locked: boolean;
  blocks: StageBlockView[];
}

interface CapaItem {
  id: string;
  auditName: string;
  object: string;
  findingText: string;
  comment: string;
  who: string;
  due: string;
  severity: string | null;
  status: 'planned' | 'done';
  createdAt: string;
  closedAt: string | null;
  effectiveness: 'not_checked' | 'effective' | 'not_effective';
  effectivenessComment: string;
  effectivenessAt: string | null;
}

interface CapaTerm {
  level: string;
  days: number;
}

type Tab = 'stages' | 'staff' | 'plan' | 'findings' | 'capa' | 'profile' | 'inventory' | 'branches' | 'cycle' | 'equipment' | 'summary' | 'selfaudit';
const EMPTY_PROFILE: ClinicProfile = { orgFull: '', orgShort: '', license: '', chiefDoctor: '', city: '' };
const EMPTY_INVENTORY_SUMMARY: InventorySummary = { total: 0, filled: 0, notFilled: 0 };
const ALLOWED_ROLES = ['clinic_admin', 'vkk_lead', 'auditor', 'observer'];

const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '14px 16px' };
const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border-1)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, width: '100%' };
const primaryBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' };
const outlineBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 7, border: '1px solid var(--border-1)', background: 'transparent', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };

export default function ClinicCabinetPage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authError, setAuthError] = useState('');
  const [aInn, setAInn] = useState('');
  const [aLogin, setALogin] = useState('');
  const [aPass, setAPass] = useState('');
  const [tab, setTab] = useState<Tab>('stages');
  const [toast, setToast] = useState('');
  const [docView, setDocView] = useState<{ name: string; content: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stages, setStages] = useState<StageView[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [pendingAccounts, setPendingAccounts] = useState<PendingAccount[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [capa, setCapa] = useState<CapaItem[]>([]);
  const [capaTerms, setCapaTerms] = useState<CapaTerm[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [cycleYear, setCycleYear] = useState<number | null>(null);
  const [cycleDirs, setCycleDirs] = useState<CycleDirectionView[]>([]);
  const [equipPositions, setEquipPositions] = useState<EquipmentPosition[]>([]);
  const [equipTypes, setEquipTypes] = useState<EquipmentTypeDef[]>([]);
  const [equipForms, setEquipForms] = useState<EquipmentFormRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [selfAuditRuns, setSelfAuditRuns] = useState<SelfAuditRunView[]>([]);
  const [checklistCatalog, setChecklistCatalog] = useState<string[]>([]);
  const [profile, setProfile] = useState<ClinicProfile>(EMPTY_PROFILE);
  const [inventoryRows, setInventoryRows] = useState<InventoryRow[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary>(EMPTY_INVENTORY_SUMMARY);

  const say = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  const loadAll = useCallback(async () => {
    const [st, s, pend, a, p, f, c, br, cy, eqp, eqt, eqf, sm, sa, chk, pr, inv] = await Promise.all([
      api.get<{ ok: true; stages: StageView[] }>('/api/clinic/stages'),
      api.get<{ ok: true; staff: StaffMember[] }>('/api/clinic/staff'),
      api.get<{ ok: true; pending: PendingAccount[] } | { ok: false; error: string }>('/api/clinic/accounts/pending'),
      api.get<{ ok: true; assignments: Record<string, string> }>('/api/clinic/assignments'),
      api.get<{ ok: true; plan: PlanItem[] }>('/api/clinic/plan'),
      api.get<{ ok: true; findings: Finding[] }>('/api/clinic/capa/findings'),
      api.get<{ ok: true; items: CapaItem[] }>('/api/clinic/capa'),
      api.get<{ ok: true; branches: Branch[] }>('/api/clinic/branches'),
      api.get<{ ok: true; year: number; dirs: CycleDirectionView[]; capaTerms: CapaTerm[] } | { ok: false; error: string }>('/api/clinic/cycle'),
      api.get<{ ok: true; positions: EquipmentPosition[] }>('/api/clinic/equipment/positions'),
      api.get<{ ok: true; types: EquipmentTypeDef[] }>('/api/panel/equip-types'),
      api.get<{ ok: true; forms: EquipmentFormRow[] }>('/api/clinic/equipment/forms'),
      api.get<{ ok: true; rows: SummaryRow[] }>('/api/clinic/summary'),
      api.get<{ ok: true; runs: SelfAuditRunView[] }>('/api/clinic/selfaudit'),
      api.get<{ ok: true; checklists: { name: string }[] }>('/api/panel/checklists'),
      api.get<{ ok: true; profile: ClinicProfile } | { ok: false; error: string }>('/api/clinic/profile'),
      api.get<{ ok: true; rows: InventoryRow[]; summary: InventorySummary } | { ok: false; error: string }>('/api/clinic/documents/inventory'),
    ]);
    if (st.ok) setStages(st.stages);
    if (s.ok) setStaff(s.staff);
    setPendingAccounts(pend.ok ? pend.pending : []); // 403 для ролей без staff:manage — не ошибка, просто нечего показывать
    if (a.ok) setAssignments(a.assignments);
    if (p.ok) setPlan(p.plan);
    if (f.ok) setFindings(f.findings);
    if (c.ok) setCapa(c.items);
    if (br.ok) setBranches(br.branches);
    if (cy.ok) { setCycleYear(cy.year); setCycleDirs(cy.dirs); setCapaTerms(cy.capaTerms); } else { setCycleYear(null); setCycleDirs([]); setCapaTerms([]); }
    if (eqp.ok) setEquipPositions(eqp.positions);
    if (eqt.ok) setEquipTypes(eqt.types);
    if (eqf.ok) setEquipForms(eqf.forms);
    if (sm.ok) setSummaryRows(sm.rows);
    if (sa.ok) setSelfAuditRuns(sa.runs);
    if (chk.ok) setChecklistCatalog(chk.checklists.map((c) => c.name));
    if (pr.ok) setProfile(pr.profile);
    if (inv.ok) { setInventoryRows(inv.rows); setInventorySummary(inv.summary); }
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
      setAuthError('Эта учётная запись не открывает Личный кабинет ВКК.');
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
            <div style={{ fontSize: 19, fontWeight: 800 }}>Личный кабинет ВКК</div>
          </div>
          {authError && <div style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, fontWeight: 700, color: 'var(--error)' }}>{authError}</div>}
          <input value={aInn} onChange={(e) => setAInn(e.target.value)} placeholder="ИНН клиники" style={{ ...inputStyle, fontFamily: 'var(--font-mono)', padding: '12px 13px', fontSize: 15 }} />
          <input value={aLogin} onChange={(e) => setALogin(e.target.value)} placeholder="Логин" style={{ ...inputStyle, padding: '12px 13px', fontSize: 15 }} />
          <input type="password" value={aPass} onChange={(e) => setAPass(e.target.value)} placeholder="Пароль" style={{ ...inputStyle, padding: '12px 13px', fontSize: 15 }} />
          <button onClick={doLogin} className="k785-tap-target" style={{ ...primaryBtn, padding: 14, fontSize: 15 }}>Войти</button>
          <a href="/" style={{ fontSize: 12.5, fontWeight: 700 }}>← на главную</a>
        </div>
      </div>
    );
  }

  const canOrderStages = session.role === 'clinic_admin';
  const canManageStaff = session.role === 'clinic_admin';
  const canAssign = session.role === 'clinic_admin' || session.role === 'vkk_lead';
  const canManagePlan = canAssign;
  const canCreateCapa = canAssign;
  const canManageBranches = session.role === 'clinic_admin';
  const canManageEquip = canAssign;
  const canManageProfile = session.role === 'clinic_admin';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'stages', label: `Этапы и документы · ${stages.length}` },
    { key: 'staff', label: pendingAccounts.length ? `Сотрудники · ${staff.length} · заявок ${pendingAccounts.length}` : `Сотрудники · ${staff.length}` },
    { key: 'plan', label: `План проверок · ${plan.length}` },
    { key: 'findings', label: `Находки · ${findings.length}` },
    { key: 'capa', label: `CAPA · ${capa.filter((c) => c.status === 'planned').length}` },
    { key: 'profile', label: 'Профиль клиники' },
    { key: 'inventory', label: `Опись документов · ${inventorySummary.total}` },
    { key: 'branches', label: `Филиалы · ${branches.length}` },
    { key: 'cycle', label: 'Годовой цикл' },
    { key: 'equipment', label: `Оборудование · ${equipPositions.length}` },
    { key: 'summary', label: 'Сводный отчёт' },
    { key: 'selfaudit', label: `Самообследование · ${selfAuditRuns.length}` },
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

        {tab === 'stages' && (
          <StagesTab stages={stages} canOrder={canOrderStages}
            onOrder={async (code) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/clinic/stages/${code}/request-payment`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Счёт выставлен, ожидает подтверждения оператора');
            }}
            onAcceptOffer={async (code) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/clinic/stages/${code}/accept-offer`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Условия оффера приняты');
            }}
            onOpen={async (name) => {
              const r = await api.get<{ ok: true; content: string } | { ok: false; error: string }>(`/api/clinic/documents/${encodeURIComponent(name)}/content`);
              if (!r.ok) { say(r.error); return; }
              setDocView({ name, content: r.content });
            }}
          />
        )}

        {tab === 'staff' && (
          <StaffTab staff={staff} assignments={assignments} canManageStaff={canManageStaff} canAssign={canAssign}
            pendingAccounts={pendingAccounts} branches={branches}
            onAddStaff={async (fio, pos) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/staff', { fio, pos });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Сотрудник сохранён');
            }}
            onRemoveStaff={async (fio) => {
              const r = await api.del<{ ok: true } | { ok: false; error: string }>('/api/clinic/staff/' + encodeURIComponent(fio));
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Сотрудник удалён');
            }}
            onAssign={async (doc, who) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/clinic/assignments/' + encodeURIComponent(doc), { who });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Назначение сохранено');
            }}
            onApproveAccount={async (id, role, branchName) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/clinic/accounts/${id}/approve`, { role, branchName: branchName || undefined });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка подтверждена, сотрудник может войти');
            }}
            onRejectAccount={async (id) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/clinic/accounts/${id}/reject`, {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Заявка отклонена');
            }}
          />
        )}

        {tab === 'plan' && (
          <PlanTab plan={plan} staff={staff} canManagePlan={canManagePlan}
            onCreate={async (input) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/plan', input);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Проверка добавлена в план');
            }}
            onDelete={async (id) => {
              const r = await api.del<{ ok: true } | { ok: false; error: string }>('/api/clinic/plan/' + id);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Проверка удалена из плана');
            }}
          />
        )}

        {tab === 'findings' && (
          <FindingsTab findings={findings} canCreateCapa={canCreateCapa} capaTerms={capaTerms}
            onPlan={async (f, who, due, severity) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/capa', { planId: f.planId, itemIndex: f.itemIndex, who, due, severity: severity || undefined });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Мероприятие добавлено в реестр корректирующих');
            }}
          />
        )}

        {tab === 'capa' && (
          <CapaTab items={capa} myFio={session.fio} canCheckEffectiveness={canCreateCapa}
            onClose={async (id) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/clinic/capa/' + id + '/status', { status: 'done' });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Мероприятие отмечено выполненным');
            }}
            onReopen={async (id) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/clinic/capa/' + id + '/status', { status: 'planned' });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Мероприятие возвращено в работу');
            }}
            onCheckEffectiveness={async (id, effective, comment) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/clinic/capa/' + id + '/effectiveness', { effective, comment });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say(effective ? 'Эффективность подтверждена' : 'Мероприятие возвращено в работу — нарушение повторилось');
            }}
          />
        )}

        {tab === 'profile' && (
          <ProfileTab profile={profile} canManage={canManageProfile}
            onSave={async (next) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/clinic/profile', next);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Реквизиты сохранены');
            }}
          />
        )}

        {tab === 'inventory' && <InventoryTab rows={inventoryRows} summary={inventorySummary} />}

        {tab === 'branches' && (
          <BranchesTab branches={branches} canManage={canManageBranches}
            onAdd={async (name) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/branches', { name });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Филиал добавлен');
            }}
            onRemove={async (id) => {
              const r = await api.del<{ ok: true } | { ok: false; error: string }>('/api/clinic/branches/' + id);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Филиал удалён');
            }}
          />
        )}

        {tab === 'cycle' && (
          <CycleTab year={cycleYear} dirs={cycleDirs} staff={staff} canManage={canManagePlan}
            onCustomize={async (name, patch) => {
              const r = await api.put<{ ok: true } | { ok: false; error: string }>('/api/clinic/cycle/' + encodeURIComponent(name), patch);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Направление настроено');
            }}
            onGenerate={async () => {
              const r = await api.post<{ ok: true; generated: number } | { ok: false; error: string }>('/api/clinic/cycle/generate', {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say(`В план добавлено строк: ${r.generated}`);
            }}
          />
        )}

        {tab === 'equipment' && (
          <EquipmentTab positions={equipPositions} types={equipTypes} forms={equipForms} canManage={canManageEquip}
            onAddPosition={async (input) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/equipment/positions', input);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Позиция добавлена');
            }}
            onRemovePosition={async (uid) => {
              const r = await api.del<{ ok: true } | { ok: false; error: string }>('/api/clinic/equipment/positions/' + uid);
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Позиция удалена');
            }}
            onFill={async (posUid, formName, value, note) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(
                `/api/clinic/equipment/positions/${posUid}/forms/${encodeURIComponent(formName)}/fill`,
                { value, note, source: 'кабинет клиники' },
              );
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Форма заполнена');
            }}
          />
        )}

        {tab === 'summary' && (
          <SummaryTab rows={summaryRows} canManage={canAssign}
            onUpload={async (name, fileName, base64) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/summary/' + encodeURIComponent(name) + '/upload', { fileName, base64 });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Файл загружен');
            }}
            onRemove={async (name) => {
              const r = await api.del<{ ok: true } | { ok: false; error: string }>('/api/clinic/summary/' + encodeURIComponent(name));
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Файл удалён');
            }}
          />
        )}

        {tab === 'selfaudit' && (
          <SelfAuditTab runs={selfAuditRuns} catalog={checklistCatalog} canManage={canManagePlan}
            onStart={async (name) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/selfaudit/' + encodeURIComponent(name) + '/start', {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Прогон начат');
            }}
            onAnswer={async (name, index, answer, comment) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/selfaudit/' + encodeURIComponent(name) + '/answer', { index, answer, comment });
              if (!r.ok) { say(r.error); return; }
              await loadAll();
            }}
            onFinish={async (name) => {
              const r = await api.post<{ ok: true; capaCreated: number } | { ok: false; error: string }>('/api/clinic/selfaudit/' + encodeURIComponent(name) + '/finish', {});
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say(r.capaCreated ? `Прогон завершён, заведено мероприятий: ${r.capaCreated}` : 'Прогон завершён, несоответствий не найдено');
            }}
            onExport={() => window.open('/api/clinic/selfaudit/export', '_blank')}
          />
        )}
      </div>

      {docView && (
        <div onClick={() => setDocView(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(16,32,31,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, maxWidth: 560, width: '100%', maxHeight: '80vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{docView.name}</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, background: 'var(--bg-app)', borderRadius: 9, padding: 14 }}>{docView.content}</pre>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => window.open(`/api/clinic/documents/${encodeURIComponent(docView.name)}/docx`, '_blank')} style={outlineBtn}>Скачать .docx</button>
              <button onClick={() => window.open(`/api/clinic/documents/${encodeURIComponent(docView.name)}/pdf`, '_blank')} style={outlineBtn}>Скачать .pdf</button>
              <button onClick={() => setDocView(null)} style={{ ...outlineBtn, marginLeft: 'auto' }}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', maxWidth: 520, background: 'var(--text-primary)', color: '#fff', padding: '12px 18px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, boxShadow: 'var(--shadow-toast)', zIndex: 40 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function StagesTab({ stages, canOrder, onOrder, onAcceptOffer, onOpen }: {
  stages: StageView[]; canOrder: boolean; onOrder: (code: number) => void; onAcceptOffer: (code: number) => void; onOpen: (name: string) => void;
}) {
  const statusLabel: Record<StagePayment['status'], string> = { none: 'не заказан', pending: 'счёт выставлен', paid: 'оплачен' };
  const statusColor: Record<StagePayment['status'], string> = { none: 'var(--text-muted)', pending: 'var(--warn)', paid: 'var(--accent-hover)' };
  const statusBg: Record<StagePayment['status'], string> = { none: 'var(--bg-app)', pending: 'var(--warn-bg)', paid: 'var(--accent-bg-light)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {stages.length === 0 && <EmptyState text="Каталог этапов ещё не опубликован методистом." />}
      {stages.map((s) => (
        <div key={s.code} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Этап {s.code} · {s.name}</div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, color: statusColor[s.payment.status], background: statusBg[s.payment.status] }}>
              {s.payment.status === 'paid' && !s.payment.accepted ? 'оплачен · ждёт приёмки платформой' : s.payment.status === 'paid' ? 'принят' : statusLabel[s.payment.status]} · {s.price.toLocaleString('ru-RU')} ₽
            </span>
          </div>
          {s.locked && s.payment.status === 'none' && (
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-caption)', marginTop: 8 }}>
              Заблокирован: нельзя заказать, пока платформа не приняла предыдущий этап.
            </div>
          )}
          {s.offerText && s.payment.status === 'none' && !s.locked && (
            <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn)', borderRadius: 9, padding: '10px 12px', marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ fontSize: 12.5, fontWeight: 800 }}>Оффер на этап {s.code}</div>
                <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 5, color: s.payment.offerAccepted ? 'var(--accent-hover)' : 'var(--warn)', background: s.payment.offerAccepted ? 'var(--accent-bg-light)' : '#fff' }}>
                  {s.payment.offerAccepted ? 'условия приняты' : 'ожидает вашего решения'}
                </span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'pre-wrap' }}>{s.offerText}</div>
              {s.offerFile && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Загружено методистом · {s.offerFile}</div>}
              {canOrder && !s.payment.offerAccepted && (
                <button onClick={() => onAcceptOffer(s.code)} style={{ ...primaryBtn, alignSelf: 'flex-start' }}>Принять условия</button>
              )}
            </div>
          )}
          {s.payment.status === 'none' && canOrder && !s.locked && (!s.offerText || s.payment.offerAccepted) && (
            <button onClick={() => onOrder(s.code)} style={{ ...primaryBtn, marginTop: 10 }}>Заказать (выставить счёт)</button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {s.blocks.map((b) => (
              <div key={b.key}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>{b.num} · {b.name}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {b.docs.map((d) => (
                    <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-3)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{d.name}</div>
                      {s.payment.status === 'paid' && d.granted ? (
                        <button onClick={() => onOpen(d.name)} style={outlineBtn}>Открыть</button>
                      ) : (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-caption)' }}>
                          {!d.granted ? 'ожидает выдачи' : 'ожидает оплаты'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StaffTab({ staff, assignments, canManageStaff, canAssign, pendingAccounts, branches, onAddStaff, onRemoveStaff, onAssign, onApproveAccount, onRejectAccount }: {
  staff: StaffMember[]; assignments: Record<string, string>; canManageStaff: boolean; canAssign: boolean;
  pendingAccounts: PendingAccount[]; branches: Branch[];
  onAddStaff: (fio: string, pos: string) => void; onRemoveStaff: (fio: string) => void; onAssign: (doc: string, who: string) => void;
  onApproveAccount: (id: string, role: string, branchName: string) => void; onRejectAccount: (id: string) => void;
}) {
  const [fio, setFio] = useState('');
  const [pos, setPos] = useState('');
  const [docName, setDocName] = useState('');
  const [docWho, setDocWho] = useState('');
  const [roleByRequest, setRoleByRequest] = useState<Record<string, string>>({});
  const [branchByRequest, setBranchByRequest] = useState<Record<string, string>>({});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {canManageStaff && pendingAccounts.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'var(--error-border)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>Заявки на доступ к клинике</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>
            Кто-то зарегистрировался на ИНН вашей клиники. Подтвердите заявку, только если действительно знаете этого человека — ИНН клиники не секрет.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingAccounts.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--border-3)' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{p.fio || p.login}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>логин «{p.login}»{p.phone ? ` · ${p.phone}` : ''}{p.email ? ` · ${p.email}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={roleByRequest[p.id] ?? p.requestedRole ?? 'observer'} onChange={(e) => setRoleByRequest((m) => ({ ...m, [p.id]: e.target.value }))} style={{ ...inputStyle, width: 'auto' }}>
                    {CLINIC_ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <select value={branchByRequest[p.id] ?? ''} onChange={(e) => setBranchByRequest((m) => ({ ...m, [p.id]: e.target.value }))} style={{ ...inputStyle, width: 'auto' }}>
                    <option value="">все филиалы</option>
                    {branches.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </select>
                  <button onClick={() => onApproveAccount(p.id, roleByRequest[p.id] ?? p.requestedRole ?? 'observer', branchByRequest[p.id] ?? '')} style={primaryBtn}>Подтвердить</button>
                  <button onClick={() => onRejectAccount(p.id)} style={outlineBtn}>Отклонить</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Штат клиники</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {staff.length === 0 && <EmptyState text="Сотрудники ещё не добавлены." />}
          {staff.map((s) => (
            <div key={s.fio} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-3)' }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{s.fio}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{s.pos || 'должность не указана'}</div>
              </div>
              {canManageStaff && <button onClick={() => onRemoveStaff(s.fio)} style={outlineBtn}>Удалить</button>}
            </div>
          ))}
        </div>
        {canManageStaff && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <input value={fio} onChange={(e) => setFio(e.target.value)} placeholder="ФИО" style={{ ...inputStyle, flex: '1 1 180px' }} />
            <input value={pos} onChange={(e) => setPos(e.target.value)} placeholder="Должность" style={{ ...inputStyle, flex: '1 1 180px' }} />
            <button onClick={() => { if (fio.trim()) { onAddStaff(fio, pos); setFio(''); setPos(''); } }} style={primaryBtn}>Добавить</button>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Матрица ответственных по документам</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.keys(assignments).length === 0 && <EmptyState text="Назначений пока нет." />}
          {Object.entries(assignments).map(([doc, who]) => (
            <div key={doc} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-3)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{doc}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{who}</div>
            </div>
          ))}
        </div>
        {canAssign && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Название документа" style={{ ...inputStyle, flex: '1 1 220px' }} />
            <select value={docWho} onChange={(e) => setDocWho(e.target.value)} style={{ ...inputStyle, flex: '1 1 160px' }}>
              <option value="">не назначен</option>
              {staff.map((s) => <option key={s.fio} value={s.fio}>{s.fio}</option>)}
            </select>
            <button onClick={() => { if (docName.trim()) { onAssign(docName, docWho); setDocName(''); setDocWho(''); } }} style={primaryBtn}>Назначить</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanTab({ plan, staff, canManagePlan, onCreate, onDelete }: {
  plan: PlanItem[]; staff: StaffMember[]; canManagePlan: boolean;
  onCreate: (input: { date: string; dir: string; object: string; who: string; kind: 'плановая' | 'внеплановая' | 'целевая' }) => void;
  onDelete: (id: string) => void;
}) {
  const [date, setDate] = useState('');
  const [dir, setDir] = useState('');
  const [object, setObject] = useState('');
  const [who, setWho] = useState('');
  const [kind, setKind] = useState<'плановая' | 'внеплановая' | 'целевая'>('плановая');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {plan.length === 0 && <EmptyState text="План проверок пуст." />}
      {plan.map((p) => (
        <div key={p.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{p.name || p.dir}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>{p.object} · {p.kind} · срок {p.date || 'не задан'} · {p.who}</div>
          </div>
          {canManagePlan && <button onClick={() => onDelete(p.id)} style={outlineBtn}>Удалить</button>}
        </div>
      ))}
      {canManagePlan && (
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Новая проверка в плане</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
            <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Направление / чек-лист" style={inputStyle} />
            <input value={object} onChange={(e) => setObject(e.target.value)} placeholder="Объект проверки" style={inputStyle} />
            <select value={who} onChange={(e) => setWho(e.target.value)} style={inputStyle}>
              <option value="">Ответственный</option>
              {staff.map((s) => <option key={s.fio} value={s.fio}>{s.fio}</option>)}
            </select>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={inputStyle}>
              <option value="плановая">плановая</option>
              <option value="внеплановая">внеплановая</option>
              <option value="целевая">целевая</option>
            </select>
          </div>
          <button
            onClick={() => { if (dir.trim() && who.trim()) { onCreate({ date, dir, object, who, kind }); setDate(''); setDir(''); setObject(''); setWho(''); } }}
            style={{ ...primaryBtn, alignSelf: 'flex-start' }}
          >
            Добавить в план проверок
          </button>
        </div>
      )}
    </div>
  );
}

function FindingsTab({ findings, canCreateCapa, capaTerms, onPlan }: { findings: Finding[]; canCreateCapa: boolean; capaTerms: CapaTerm[]; onPlan: (f: Finding, who: string, due: string, severity: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {findings.length === 0 && <EmptyState text="Открытых находок нет — все нарушения уже превращены в мероприятия или нарушений не было." />}
      {findings.map((f) => (
        <FindingRow key={`${f.planId}|${f.itemIndex}`} finding={f} canCreateCapa={canCreateCapa} capaTerms={capaTerms} onPlan={onPlan} />
      ))}
    </div>
  );
}

function FindingRow({ finding, canCreateCapa, capaTerms, onPlan }: { finding: Finding; canCreateCapa: boolean; capaTerms: CapaTerm[]; onPlan: (f: Finding, who: string, due: string, severity: string) => void }) {
  const [who, setWho] = useState('');
  const [due, setDue] = useState('');
  const [severity, setSeverity] = useState('');
  return (
    <div style={{ ...cardStyle, borderColor: '#f0d9d5', background: '#fdf5f4' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#7c2b22' }}>{finding.auditName}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{finding.object}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8 }}>{finding.text}</div>
      {finding.comment && <div style={{ fontSize: 12, color: '#7c2b22', fontWeight: 600, marginTop: 4 }}>{finding.comment}</div>}
      {canCreateCapa && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Ответственный (ФИО)" style={{ ...inputStyle, flex: '1 1 180px' }} />
          {capaTerms.length > 0 ? (
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={{ ...inputStyle, flex: '1 1 180px' }}>
              <option value="">срок — вручную</option>
              {capaTerms.map((t) => <option key={t.level} value={t.level}>{t.level} · {t.days} дн.</option>)}
            </select>
          ) : (
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ ...inputStyle, flex: '1 1 140px' }} />
          )}
          {capaTerms.length > 0 && !severity && <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ ...inputStyle, flex: '1 1 140px' }} />}
          <button onClick={() => onPlan(finding, who, due, severity)} style={primaryBtn}>Запланировать корректирующие мероприятия</button>
        </div>
      )}
    </div>
  );
}

function CapaTab({ items, myFio, canCheckEffectiveness, onClose, onReopen, onCheckEffectiveness }: {
  items: CapaItem[]; myFio: string; canCheckEffectiveness: boolean;
  onClose: (id: string) => void; onReopen: (id: string) => void; onCheckEffectiveness: (id: string, effective: boolean, comment: string) => void;
}) {
  const [commentById, setCommentById] = useState<Record<string, string>>({});
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.length === 0 && <EmptyState text="Открытых мероприятий нет. Заведите их в разделе «Находки»." />}
      {items.map((c) => {
        const isMine = c.who === myFio;
        return (
          <div key={c.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{c.findingText}</div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, color: c.status === 'done' ? 'var(--accent-hover)' : 'var(--warn)', background: c.status === 'done' ? 'var(--accent-bg-light)' : 'var(--warn-bg)' }}>
                {c.status === 'done' ? `выполнено ${c.closedAt}` : 'запланировано'}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 4 }}>
              {c.auditName} · {c.object} · ответственный: {c.who}{c.due ? ` · срок ${c.due}` : ''}{c.severity ? ` · степень: ${c.severity}` : ''}
            </div>
            {c.status === 'done' && c.effectiveness === 'effective' && (
              <div style={{ fontSize: 11, color: 'var(--accent-hover)', fontWeight: 700, marginTop: 6 }}>эффективность подтверждена {c.effectivenessAt}{c.effectivenessComment ? ` · ${c.effectivenessComment}` : ''}</div>
            )}
            {c.status === 'planned' && isMine && <button onClick={() => onClose(c.id)} style={{ ...primaryBtn, marginTop: 10 }}>Отметить выполненным</button>}
            {c.status === 'done' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={() => onReopen(c.id)} style={outlineBtn}>Вернуть в работу</button>
                {canCheckEffectiveness && c.effectiveness !== 'effective' && (
                  <>
                    <input value={commentById[c.id] ?? ''} onChange={(e) => setCommentById((m) => ({ ...m, [c.id]: e.target.value }))} placeholder="Комментарий к проверке" style={{ ...inputStyle, flex: '1 1 180px' }} />
                    <button onClick={() => onCheckEffectiveness(c.id, true, commentById[c.id] ?? '')} style={primaryBtn}>Эффективно</button>
                    <button onClick={() => onCheckEffectiveness(c.id, false, commentById[c.id] ?? '')} style={{ ...outlineBtn, borderColor: 'var(--error-border)', color: 'var(--error)' }}>Нарушение повторилось</button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
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
