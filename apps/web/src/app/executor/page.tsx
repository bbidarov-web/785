'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Кабинет исполнителя — 1:1 перенос reference/prototype/Кабинет исполнителя.dc.html
 * на реальный API (см. apps/api/src/executor). Тексты, цвета и состояния — дословно
 * из прототипа (CLAUDE.md: "Тексты... брать из прототипа дословно").
 */

interface SessionInfo {
  accountId: string;
  inn: string;
  login: string;
  side: 'platform' | 'clinic';
  role: string;
  org: string | null;
  fio: string;
}

interface ExecutorDoc {
  code: string;
  name: string;
  where: string;
  done: boolean;
  doneAt: string | null;
  together: string[];
}
interface ExecutorCheck {
  name: string;
  where: string;
  done: boolean;
  date: string | null;
}
interface ExecutorLog {
  form: string;
  positionName: string;
  hasEntries: boolean;
  lastDate: string | null;
  lastBy: string | null;
}
interface ExecutorOverview {
  fio: string;
  position: string;
  clinicName: string;
  inn: string;
  docs: ExecutorDoc[];
  checks: ExecutorCheck[];
  logs: ExecutorLog[];
}

type Tab = 'docs' | 'checks' | 'logs';

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const word = a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  return `${n} ${word}`;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-2)',
  borderRadius: 11,
  padding: '14px 16px',
};

export default function ExecutorCabinetPage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [overview, setOverview] = useState<ExecutorOverview | null>(null);
  const [tab, setTab] = useState<Tab>('docs');
  const [toast, setToast] = useState('');
  const [authError, setAuthError] = useState('');
  const [aInn, setAInn] = useState('');
  const [aPhone, setAPhone] = useState('');
  const [aPass, setAPass] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  const loadOverview = useCallback(async () => {
    const r = await api.get<{ ok: true; overview: ExecutorOverview } | { ok: false; error: string }>('/api/executor/overview');
    if (r.ok) setOverview(r.overview);
  }, []);

  useEffect(() => {
    (async () => {
      const r = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session');
      const ok = r.ok && r.session && r.session.side === 'clinic' && r.session.role === 'nurse';
      setSession(ok ? r.session : null);
      setReady(true);
      if (ok) await loadOverview();
    })();
  }, [loadOverview]);

  async function doLogin() {
    if (!aInn.trim() || !aPhone.trim() || !aPass) {
      setAuthError('Введите ИНН клиники, телефон и пароль');
      return;
    }
    const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/auth/login-by-phone', { inn: aInn, phone: aPhone, password: aPass });
    if (!r.ok) {
      setAuthError(r.error);
      return;
    }
    const s = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session');
    if (!s.ok || !s.session || s.session.role !== 'nurse') {
      await api.post('/api/auth/logout');
      setAuthError('Эта учётная запись — не исполнитель. Войдите в кабинет клиники.');
      return;
    }
    setSession(s.session);
    setAuthError('');
    setAPass('');
    await loadOverview();
  }

  async function doLogout() {
    await api.post('/api/auth/logout');
    setSession(null);
    setOverview(null);
    setAPass('');
  }

  async function markDone(code: string, label: string) {
    await api.post(`/api/executor/docs/${encodeURIComponent(code)}/done`, {});
    await loadOverview();
    say('Отмечено выполненным: ' + label);
  }

  if (!ready) return null;

  if (!session) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px 18px', background: 'var(--bg-app)' }}>
        <div style={{ width: '100%', maxWidth: 400, background: 'var(--bg-card)', border: '1px solid var(--border-1)', borderRadius: 16, padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-caption)' }}>Контур 785</div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>Кабинет исполнителя</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 4 }}>
              Вход по ИНН клиники и рабочему телефону. Доступ выдаёт клиника — вы видите только то, где назначены исполнителем.
            </div>
          </div>

          {authError && (
            <div style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, fontWeight: 700, color: 'var(--error)', lineHeight: 1.45 }}>
              {authError}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <Field label="ИНН клиники">
              <input value={aInn} onChange={(e) => setAInn(e.target.value)} placeholder="10 или 12 цифр" style={monoInputStyle} />
            </Field>
            <Field label="Рабочий телефон">
              <input value={aPhone} onChange={(e) => setAPhone(e.target.value)} placeholder="+7 900 000-00-00" style={monoInputStyle} />
            </Field>
            <Field label="Пароль">
              <input type="password" value={aPass} onChange={(e) => setAPass(e.target.value)} placeholder="пароль" style={inputStyle} />
            </Field>
            <button onClick={doLogin} className="k785-tap-target" style={primaryButtonStyle}>
              Войти
            </button>
          </div>

          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', lineHeight: 1.5, borderTop: '1px solid var(--border-3)', paddingTop: 12 }}>
            Нет доступа или забыли пароль — обратитесь к ответственному за ВКК вашей клиники.
          </div>
        </div>
      </div>
    );
  }

  const docs = overview?.docs ?? [];
  const checks = overview?.checks ?? [];
  const logs = overview?.logs ?? [];
  const fio = overview?.fio ?? session.fio;
  const initials = fio.split(' ').slice(0, 2).map((w) => w[0]).join('');
  const clinicName = overview?.clinicName ?? session.org ?? `ИНН ${session.inn}`;
  const scopeNote =
    `Вы работаете от имени «${clinicName}» только там, где клиника назначила вас исполнителем: ` +
    `${plural(docs.length, 'документ', 'документа', 'документов')}, ` +
    `${plural(checks.length, 'проверка', 'проверки', 'проверок')}, ` +
    `${plural(logs.length, 'журнал', 'журнала', 'журналов')}. Остальное клиника вам не открыла — состав назначений меняется в кабинете клиники, во вкладке «Сотрудники и матрица ответственных».`;

  const kpis = [
    { val: String(docs.length), name: 'документов на вас', color: 'var(--text-primary)' },
    { val: String(docs.filter((d) => d.done).length), name: 'отмечено выполненными', color: 'var(--accent-hover)' },
    { val: String(checks.length), name: 'проверок назначено', color: 'var(--info)' },
    { val: String(logs.filter((l) => !l.hasEntries).length), name: 'журналов без записей', color: 'var(--error)' },
  ];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'docs', label: `Мои документы · ${docs.length}` },
    { key: 'checks', label: `Мои проверки · ${checks.length}` },
    { key: 'logs', label: `Мои журналы · ${logs.length}` },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
      <div style={{ background: 'var(--sidebar-bg)', color: 'var(--sidebar-text)', padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent-on-dark)', color: '#06231f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>
          {initials}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 'auto', minWidth: 0, flex: '1 1 180px' }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{fio}</div>
          <div style={{ fontSize: 11.5, color: 'var(--sidebar-muted)', fontWeight: 600, overflowWrap: 'anywhere' }}>
            {(overview?.position || 'должность не указана') + ' · исполнитель'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, overflowWrap: 'anywhere' }}>{clinicName}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--sidebar-muted)' }}>ИНН {session.inn}</div>
        </div>
        <button onClick={doLogout} className="k785-tap-target" style={ghostDarkButtonStyle}>
          Выйти
        </button>
      </div>

      <div style={{ padding: '20px clamp(12px, 4vw, 22px) 32px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-1)', borderRadius: 12, padding: '16px 18px', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {scopeNote}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 10 }}>
          {kpis.map((k) => (
            <div key={k.name} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 800, color: k.color }}>{k.val}</div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', lineHeight: 1.35 }}>{k.name}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="k785-tap-target"
              style={{
                padding: '9px 14px',
                borderRadius: 8,
                background: tab === t.key ? 'var(--text-primary)' : 'var(--bg-card)',
                color: tab === t.key ? '#ffffff' : 'var(--text-primary)',
                border: `1px solid ${tab === t.key ? 'var(--text-primary)' : 'var(--border-1)'}`,
                fontSize: 12.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'docs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {docs.length === 0 && (
              <EmptyState text="На вас пока не назначен ни один документ. Назначение делает ответственный за ВКК в кабинете клиники — до этого документы вам не видны." />
            )}
            {docs.map((d) => (
              <div key={d.code} style={{ ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '10px 16px', alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{d.name}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{d.where}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: d.done ? 'var(--accent-hover)' : 'var(--warn)', background: d.done ? 'var(--accent-bg-light)' : 'var(--warn-bg)', padding: '3px 7px', borderRadius: 5, alignSelf: 'flex-start' }}>
                    {d.done ? `выполнено ${d.doneAt}` : 'в работе'}
                  </span>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                    {d.together.length ? 'вместе с: ' + d.together.join(', ') : 'единственный исполнитель'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <button
                    className="k785-tap-target"
                    onClick={() => say('«' + d.name + '» · вы назначены исполнителем. Правка документа ведётся в кабинете клиники ответственным за ВКК — вам открыт просмотр и отметка о выполнении.')}
                    style={secondaryButtonStyle}
                  >
                    Открыть
                  </button>
                  <button className="k785-tap-target" onClick={() => markDone(d.code, d.name)} style={primaryButtonStyleSm}>
                    {d.done ? 'Отмечено' : 'Выполнено'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'checks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {checks.length === 0 && (
              <EmptyState text="Проверок на вас не назначено. Как только клиника поставит вас проверяющим в плане, чек-лист появится здесь и откроется в обходе." />
            )}
            {checks.map((c, i) => (
              <div key={i} style={{ ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '10px 16px', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{c.name}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{c.where}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: c.done ? 'var(--accent-hover)' : 'var(--info)', background: c.done ? 'var(--accent-bg-light)' : 'var(--info-bg)', padding: '3px 7px', borderRadius: 5, alignSelf: 'flex-start' }}>
                    {c.done ? 'проведена' : 'назначена'}
                  </span>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)' }}>{c.date ? 'срок ' + c.date : 'срок не задан'}</div>
                </div>
                <a href={`/walk?clinic=${session.inn}`} style={primaryLinkStyle}>
                  Пройти в обходе
                </a>
              </div>
            ))}
          </div>
        )}

        {tab === 'logs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {logs.length === 0 && <EmptyState text="Журналы по оборудованию на вас не закреплены." />}
            {logs.map((l, i) => (
              <div key={i} style={{ ...cardStyle, padding: '13px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '10px 16px', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{l.form}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{l.positionName}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: l.hasEntries ? 'var(--accent-hover)' : 'var(--error)' }}>
                    {l.hasEntries ? 'заполнялся' : 'записей нет'}
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                    {l.hasEntries ? `последняя запись ${l.lastDate} · ${l.lastBy ?? ''}` : 'ни одной записи'}
                  </div>
                </div>
                <a href={`/walk?clinic=${session.inn}`} style={outlineLinkStyle}>
                  Заполнить
                </a>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-caption)', lineHeight: 1.5 }}>
          Доступ выдан клиникой по ИНН и рабочему телефону. Вы действуете от имени клиники в границах своих назначений: править состав документов, видеть деньги и работать за других сотрудников кабинет исполнителя не позволяет.
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', maxWidth: 520, background: 'var(--text-primary)', color: '#ffffff', padding: '12px 18px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, boxShadow: 'var(--shadow-toast)', zIndex: 40 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-caption)' }}>{label}</div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px dashed #cfd8d7', borderRadius: 12, padding: 30, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.55 }}>
      {text}
    </div>
  );
}

const inputStyle: React.CSSProperties = { padding: '12px 13px', border: '1px solid var(--border-1)', borderRadius: 9, fontSize: 15, fontWeight: 600 };
const monoInputStyle: React.CSSProperties = { ...inputStyle, fontFamily: 'var(--font-mono)' };
const primaryButtonStyle: React.CSSProperties = { padding: 14, border: 'none', borderRadius: 9, background: 'var(--accent)', color: '#ffffff', fontSize: 15, fontWeight: 700, textAlign: 'center' };
const primaryButtonStyleSm: React.CSSProperties = { padding: '8px 12px', border: 'none', borderRadius: 7, background: 'var(--accent)', color: '#ffffff', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };
const secondaryButtonStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border-1)', background: 'transparent', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };
const ghostDarkButtonStyle: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: '1px solid #2c4442', background: 'transparent', color: 'var(--sidebar-text)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' };
const primaryLinkStyle: React.CSSProperties = { padding: '9px 12px', borderRadius: 7, background: 'var(--accent)', color: '#ffffff', fontSize: 11.5, fontWeight: 700, textDecoration: 'none', textAlign: 'center', whiteSpace: 'nowrap' };
const outlineLinkStyle: React.CSSProperties = { padding: '9px 12px', borderRadius: 7, border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 11.5, fontWeight: 700, textDecoration: 'none', textAlign: 'center', whiteSpace: 'nowrap' };
