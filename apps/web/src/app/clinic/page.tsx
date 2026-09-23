'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  BranchesTab, CycleTab, EquipmentTab, SummaryTab, SelfAuditTab,
  type Branch, type CycleDirectionView, type EquipmentPosition, type EquipmentTypeDef, type EquipmentFormRow,
  type SummaryRow, type SelfAuditRunView,
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
  payment: StagePayment;
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
  status: 'planned' | 'done';
  createdAt: string;
  closedAt: string | null;
}

type Tab = 'stages' | 'staff' | 'plan' | 'findings' | 'capa' | 'branches' | 'cycle' | 'equipment' | 'summary' | 'selfaudit';
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
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [capa, setCapa] = useState<CapaItem[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [cycleYear, setCycleYear] = useState<number | null>(null);
  const [cycleDirs, setCycleDirs] = useState<CycleDirectionView[]>([]);
  const [equipPositions, setEquipPositions] = useState<EquipmentPosition[]>([]);
  const [equipTypes, setEquipTypes] = useState<EquipmentTypeDef[]>([]);
  const [equipForms, setEquipForms] = useState<EquipmentFormRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [selfAuditRuns, setSelfAuditRuns] = useState<SelfAuditRunView[]>([]);
  const [checklistCatalog, setChecklistCatalog] = useState<string[]>([]);

  const say = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  const loadAll = useCallback(async () => {
    const [st, s, a, p, f, c, br, cy, eqp, eqt, eqf, sm, sa, chk] = await Promise.all([
      api.get<{ ok: true; stages: StageView[] }>('/api/clinic/stages'),
      api.get<{ ok: true; staff: StaffMember[] }>('/api/clinic/staff'),
      api.get<{ ok: true; assignments: Record<string, string> }>('/api/clinic/assignments'),
      api.get<{ ok: true; plan: PlanItem[] }>('/api/clinic/plan'),
      api.get<{ ok: true; findings: Finding[] }>('/api/clinic/capa/findings'),
      api.get<{ ok: true; items: CapaItem[] }>('/api/clinic/capa'),
      api.get<{ ok: true; branches: Branch[] }>('/api/clinic/branches'),
      api.get<{ ok: true; year: number; dirs: CycleDirectionView[] } | { ok: false; error: string }>('/api/clinic/cycle'),
      api.get<{ ok: true; positions: EquipmentPosition[] }>('/api/clinic/equipment/positions'),
      api.get<{ ok: true; types: EquipmentTypeDef[] }>('/api/panel/equip-types'),
      api.get<{ ok: true; forms: EquipmentFormRow[] }>('/api/clinic/equipment/forms'),
      api.get<{ ok: true; rows: SummaryRow[] }>('/api/clinic/summary'),
      api.get<{ ok: true; runs: SelfAuditRunView[] }>('/api/clinic/selfaudit'),
      api.get<{ ok: true; checklists: { name: string }[] }>('/api/panel/checklists'),
    ]);
    if (st.ok) setStages(st.stages);
    if (s.ok) setStaff(s.staff);
    if (a.ok) setAssignments(a.assignments);
    if (p.ok) setPlan(p.plan);
    if (f.ok) setFindings(f.findings);
    if (c.ok) setCapa(c.items);
    if (br.ok) setBranches(br.branches);
    if (cy.ok) { setCycleYear(cy.year); setCycleDirs(cy.dirs); } else { setCycleYear(null); setCycleDirs([]); }
    if (eqp.ok) setEquipPositions(eqp.positions);
    if (eqt.ok) setEquipTypes(eqt.types);
    if (eqf.ok) setEquipForms(eqf.forms);
    if (sm.ok) setSummaryRows(sm.rows);
    if (sa.ok) setSelfAuditRuns(sa.runs);
    if (chk.ok) setChecklistCatalog(chk.checklists.map((c) => c.name));
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'stages', label: `Этапы и документы · ${stages.length}` },
    { key: 'staff', label: `Сотрудники · ${staff.length}` },
    { key: 'plan', label: `План проверок · ${plan.length}` },
    { key: 'findings', label: `Находки · ${findings.length}` },
    { key: 'capa', label: `CAPA · ${capa.filter((c) => c.status === 'planned').length}` },
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
            onOpen={async (name) => {
              const r = await api.get<{ ok: true; content: string } | { ok: false; error: string }>(`/api/clinic/documents/${encodeURIComponent(name)}/content`);
              if (!r.ok) { say(r.error); return; }
              setDocView({ name, content: r.content });
            }}
          />
        )}

        {tab === 'staff' && (
          <StaffTab staff={staff} assignments={assignments} canManageStaff={canManageStaff} canAssign={canAssign}
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
          <FindingsTab findings={findings} canCreateCapa={canCreateCapa}
            onPlan={async (f, who, due) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/capa', { planId: f.planId, itemIndex: f.itemIndex, who, due });
              if (!r.ok) { say(r.error); return; }
              await loadAll(); say('Мероприятие добавлено в реестр корректирующих');
            }}
          />
        )}

        {tab === 'capa' && (
          <CapaTab items={capa} myFio={session.fio}
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
          />
        )}

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
            <button onClick={() => setDocView(null)} style={{ ...outlineBtn, alignSelf: 'flex-start' }}>Закрыть</button>
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

function StagesTab({ stages, canOrder, onOrder, onOpen }: { stages: StageView[]; canOrder: boolean; onOrder: (code: number) => void; onOpen: (name: string) => void }) {
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
              {statusLabel[s.payment.status]} · {s.price.toLocaleString('ru-RU')} ₽
            </span>
          </div>
          {s.payment.status === 'none' && canOrder && (
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

function StaffTab({ staff, assignments, canManageStaff, canAssign, onAddStaff, onRemoveStaff, onAssign }: {
  staff: StaffMember[]; assignments: Record<string, string>; canManageStaff: boolean; canAssign: boolean;
  onAddStaff: (fio: string, pos: string) => void; onRemoveStaff: (fio: string) => void; onAssign: (doc: string, who: string) => void;
}) {
  const [fio, setFio] = useState('');
  const [pos, setPos] = useState('');
  const [docName, setDocName] = useState('');
  const [docWho, setDocWho] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

function FindingsTab({ findings, canCreateCapa, onPlan }: { findings: Finding[]; canCreateCapa: boolean; onPlan: (f: Finding, who: string, due: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {findings.length === 0 && <EmptyState text="Открытых находок нет — все нарушения уже превращены в мероприятия или нарушений не было." />}
      {findings.map((f) => (
        <FindingRow key={`${f.planId}|${f.itemIndex}`} finding={f} canCreateCapa={canCreateCapa} onPlan={onPlan} />
      ))}
    </div>
  );
}

function FindingRow({ finding, canCreateCapa, onPlan }: { finding: Finding; canCreateCapa: boolean; onPlan: (f: Finding, who: string, due: string) => void }) {
  const [who, setWho] = useState('');
  const [due, setDue] = useState('');
  return (
    <div style={{ ...cardStyle, borderColor: '#f0d9d5', background: '#fdf5f4' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#7c2b22' }}>{finding.auditName}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{finding.object}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8 }}>{finding.text}</div>
      {finding.comment && <div style={{ fontSize: 12, color: '#7c2b22', fontWeight: 600, marginTop: 4 }}>{finding.comment}</div>}
      {canCreateCapa && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Ответственный (ФИО)" style={{ ...inputStyle, flex: '1 1 180px' }} />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ ...inputStyle, flex: '1 1 140px' }} />
          <button onClick={() => onPlan(finding, who, due)} style={primaryBtn}>Запланировать корректирующие мероприятия</button>
        </div>
      )}
    </div>
  );
}

function CapaTab({ items, myFio, onClose, onReopen }: { items: CapaItem[]; myFio: string; onClose: (id: string) => void; onReopen: (id: string) => void }) {
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
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 4 }}>{c.auditName} · {c.object} · ответственный: {c.who}{c.due ? ` · срок ${c.due}` : ''}</div>
            {c.status === 'planned' && isMine && <button onClick={() => onClose(c.id)} style={{ ...primaryBtn, marginTop: 10 }}>Отметить выполненным</button>}
            {c.status === 'done' && <button onClick={() => onReopen(c.id)} style={{ ...outlineBtn, marginTop: 10 }}>Вернуть в работу</button>}
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
