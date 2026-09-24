'use client';

import { useEffect, useState } from 'react';

const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '14px 16px' };
const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border-1)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, width: '100%' };
const primaryBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' };
const outlineBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 7, border: '1px solid var(--border-1)', background: 'transparent', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };
const dashedBtn: React.CSSProperties = { ...outlineBtn, borderStyle: 'dashed', color: 'var(--accent)' };

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px dashed #cfd8d7', borderRadius: 12, padding: 24, textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.5 }}>
      {text}
    </div>
  );
}

// --- Тарифы и продукты ---

export interface TariffDraft {
  key: string;
  name: string;
  price: number;
  period: 'monthly' | 'annual';
  description: string;
  active: boolean;
}

export function TariffsForm({ tariffs, canManage, onSaveDraft, onPublish, onDelete }: {
  tariffs: TariffDraft[]; canManage: boolean;
  onSaveDraft: (next: TariffDraft[]) => void;
  onPublish: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const [draft, setDraft] = useState<TariffDraft[]>(tariffs);
  useEffect(() => setDraft(tariffs), [tariffs]);

  function updateTariff(i: number, patch: Partial<TariffDraft>) {
    setDraft((d) => d.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  if (!canManage && !tariffs.length) return <EmptyState text="Тарифов пока нет." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
        Черновик правится напрямую. Включение тарифа в продажу и удаление уже опубликованного — операции второй руки: нужно подтверждение другого сотрудника (вкладка «Вторая рука»).
      </div>
      {draft.map((t, i) => (
        <div key={i} style={cardStyle}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
            <input value={t.key} disabled={!canManage || tariffs.some((x) => x.key === t.key)} onChange={(e) => updateTariff(i, { key: e.target.value })} placeholder="Ключ" style={{ ...inputStyle, flex: '0 1 140px', fontFamily: 'var(--font-mono)' }} />
            <input value={t.name} disabled={!canManage} onChange={(e) => updateTariff(i, { name: e.target.value })} placeholder="Название" style={{ ...inputStyle, flex: '1 1 180px' }} />
            <input type="number" value={t.price} disabled={!canManage} onChange={(e) => updateTariff(i, { price: Number(e.target.value) })} placeholder="Цена, ₽" style={{ ...inputStyle, flex: '0 1 130px' }} />
            <select value={t.period} disabled={!canManage} onChange={(e) => updateTariff(i, { period: e.target.value as TariffDraft['period'] })} style={{ ...inputStyle, flex: '0 1 130px' }}>
              <option value="monthly">в месяц</option>
              <option value="annual">в год</option>
            </select>
            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 9px', borderRadius: 6, color: t.active ? 'var(--accent-hover)' : 'var(--text-muted)', background: t.active ? 'var(--accent-bg-light)' : 'var(--bg-app)' }}>
              {t.active ? 'в продаже' : 'черновик'}
            </span>
          </div>
          <input value={t.description} disabled={!canManage} onChange={(e) => updateTariff(i, { description: e.target.value })} placeholder="Описание" style={inputStyle} />
          {canManage && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {!tariffs.some((x) => x.key === t.key) && (
                <button onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} style={outlineBtn}>Удалить черновик</button>
              )}
              {!t.active && tariffs.some((x) => x.key === t.key) && (
                <button onClick={() => onPublish(t.key)} style={primaryBtn}>Опубликовать (вторая рука)</button>
              )}
              {t.active && (
                <button onClick={() => onDelete(t.key)} style={{ ...outlineBtn, color: 'var(--error)', borderColor: 'var(--error-border)' }}>Удалить тариф (вторая рука)</button>
              )}
            </div>
          )}
        </div>
      ))}
      {canManage && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setDraft((d) => d.concat([{ key: '', name: '', price: 0, period: 'monthly', description: '', active: false }]))} style={dashedBtn}>+ тариф</button>
          <button onClick={() => onSaveDraft(draft)} style={primaryBtn}>Сохранить черновик</button>
        </div>
      )}
    </div>
  );
}

// --- Подписки клиник ---

export interface SubscriptionRow {
  inn: string;
  name: string;
  tariffKey: string | null;
  tariffName: string | null;
  status: 'none' | 'trial' | 'active' | 'expired' | 'cancelled';
  startedAt: string | null;
  expiresAt: string | null;
}

const SUB_STATUS_LABEL: Record<SubscriptionRow['status'], string> = {
  none: 'нет подписки', trial: 'пробный период', active: 'активна', expired: 'истекла', cancelled: 'отменена',
};
const SUB_STATUS_COLOR: Record<SubscriptionRow['status'], string> = {
  none: 'var(--text-muted)', trial: 'var(--warn)', active: 'var(--accent-hover)', expired: 'var(--error)', cancelled: 'var(--text-caption)',
};

export interface SubscriptionSummary {
  activeCount: number;
  totalContracts: number;
  expiringSoonCount: number;
  overdueCount: number;
  revenueThisCycle: number;
  ordersToPaySum: number;
  ordersToPayCount: number;
}

function SubscriptionSummaryCards({ summary }: { summary: SubscriptionSummary | null }) {
  if (!summary) return null;
  const cell: React.CSSProperties = { ...cardStyle, flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: 4 };
  const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-caption)' };
  const value: React.CSSProperties = { fontSize: 19, fontWeight: 800 };
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <div style={cell}><span style={label}>Активных подписок</span><span style={value}>{summary.activeCount}</span><span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>из {summary.totalContracts} договоров</span></div>
      <div style={{ ...cell, borderColor: summary.expiringSoonCount ? 'var(--warn)' : undefined }}>
        <span style={label}>Истекают в 14 дней</span><span style={{ ...value, color: summary.expiringSoonCount ? 'var(--warn)' : undefined }}>{summary.expiringSoonCount}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>нужно продление</span>
      </div>
      <div style={cell}>
        <span style={label}>Просрочено</span><span style={{ ...value, color: summary.overdueCount ? 'var(--error)' : undefined }}>{summary.overdueCount}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>доступ ограничен</span>
      </div>
      <div style={cell}><span style={label}>Выручка по подпискам</span><span style={value}>{summary.revenueThisCycle.toLocaleString('ru-RU')} ₽</span><span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>в текущем цикле</span></div>
      <div style={cell}>
        <span style={label}>Заказы к оплате</span><span style={value}>{summary.ordersToPaySum.toLocaleString('ru-RU')} ₽</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{summary.ordersToPayCount} {summary.ordersToPayCount === 1 ? 'счёт не оплачен' : 'счетов не оплачено'}</span>
      </div>
    </div>
  );
}

export function SubscriptionsPanel({ rows, tariffs, summary, canManage, onAssign, onRenew, onCancel }: {
  rows: SubscriptionRow[]; tariffs: TariffDraft[]; summary: SubscriptionSummary | null; canManage: boolean;
  onAssign: (inn: string, tariffKey: string, days: number, trial: boolean) => void;
  onRenew: (inn: string, days: number) => void;
  onCancel: (inn: string) => void;
}) {
  const [q, setQ] = useState('');
  const [assignInn, setAssignInn] = useState('');
  const [assignTariff, setAssignTariff] = useState('');
  const [assignDays, setAssignDays] = useState('30');
  const [assignTrial, setAssignTrial] = useState(false);
  const activeTariffs = tariffs.filter((t) => t.active);
  const filtered = rows.filter((r) => !q.trim() || r.inn.includes(q.trim()) || r.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SubscriptionSummaryCards summary={summary} />
      {canManage && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Назначить тариф клинике</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={assignInn} onChange={(e) => setAssignInn(e.target.value)} placeholder="ИНН клиники" style={{ ...inputStyle, flex: '1 1 180px', fontFamily: 'var(--font-mono)' }} />
            <select value={assignTariff} onChange={(e) => setAssignTariff(e.target.value)} style={{ ...inputStyle, flex: '1 1 160px' }}>
              <option value="">— тариф —</option>
              {activeTariffs.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <input type="number" value={assignDays} onChange={(e) => setAssignDays(e.target.value)} placeholder="Срок, дней" style={{ ...inputStyle, flex: '0 1 120px' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={assignTrial} onChange={(e) => setAssignTrial(e.target.checked)} /> пробный период
            </label>
            <button
              onClick={() => { if (assignInn.trim() && assignTariff) onAssign(assignInn.trim(), assignTariff, Number(assignDays) || 30, assignTrial); }}
              style={primaryBtn}
            >
              Назначить
            </button>
          </div>
        </div>
      )}

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по ИНН или названию" style={inputStyle} />
      {filtered.length === 0 && <EmptyState text="Подписок пока нет." />}
      {filtered.map((r) => (
        <div key={r.inn} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{r.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>ИНН {r.inn}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>{r.tariffName ?? '—'}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 9px', borderRadius: 6, color: SUB_STATUS_COLOR[r.status], background: 'var(--bg-app)' }}>{SUB_STATUS_LABEL[r.status]}</span>
            {r.expiresAt && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>до {r.expiresAt}</span>}
            {canManage && r.status !== 'none' && r.status !== 'cancelled' && (
              <>
                <button onClick={() => onRenew(r.inn, 30)} style={outlineBtn}>+30 дн.</button>
                <button onClick={() => onCancel(r.inn)} style={{ ...outlineBtn, color: 'var(--error)' }}>Отменить</button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Массовые операции по каталогу клиентов ---

export interface BulkClient {
  inn: string;
  name: string;
}

export interface BulkPreviewRow {
  inn: string;
  name: string;
  ok: boolean;
  why: string;
  preview: string;
}

export interface BulkReport {
  id: string;
  actionKey: string;
  label: string;
  at: string;
  done: { inn: string; name: string }[];
  skipped: { inn: string; name: string; why: string }[];
  failed: { inn: string; name: string; why: string }[];
  undoable: boolean;
  undoneAt: string | null;
}

/** Пачка больше 20 клиник после подтверждения второй рукой применяется в фоне — панель опрашивает прогресс. */
export interface BulkJob {
  id: string;
  actionKey: string;
  status: 'running' | 'done' | 'failed';
  total: number;
  doneCount: number;
  reportId: string | null;
  error: string | null;
}

const BULK_ACTION_OPTIONS = [
  { key: 'subscription-extend', label: 'Продлить подписку (+30 дней)', group: 'money' as const },
  { key: 'subscription-remind', label: 'Напомнить об оплате', group: 'money' as const },
  { key: 'cycle-bulk-apply', label: 'Применить годовой цикл эталона', group: 'standard' as const },
];

export function BulkOperationsPanel({ clients, canMoney, canMethodology, reports, activeJob, onPrepare, onCommit, onUndo, onRefreshJob }: {
  clients: BulkClient[]; canMoney: boolean; canMethodology: boolean; reports: BulkReport[]; activeJob: BulkJob | null;
  onPrepare: (action: string, inns: string[]) => Promise<{ label: string; undoable: boolean; rows: BulkPreviewRow[] } | null>;
  onCommit: (action: string, inns: string[]) => void;
  onUndo: (reportId: string) => void;
  onRefreshJob: () => void;
}) {
  const [action, setAction] = useState(BULK_ACTION_OPTIONS[0]!.key);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<{ label: string; undoable: boolean; rows: BulkPreviewRow[] } | null>(null);

  const options = BULK_ACTION_OPTIONS.filter((o) => (o.group === 'money' ? canMoney : canMethodology));
  if (!options.length) return <EmptyState text="Массовые операции доступны сотрудникам платформы с правом на деньги или методологию." />;

  const filtered = clients.filter((c) => !q.trim() || c.inn.includes(q.trim()) || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const pickedInns = Object.keys(picked).filter((k) => picked[k]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {activeJob && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Фоновая пачка: {activeJob.status === 'running' ? 'выполняется' : activeJob.status === 'done' ? 'завершена' : 'ошибка'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
            обработано {activeJob.doneCount} из {activeJob.total}{activeJob.error ? ` · ${activeJob.error}` : ''}
          </div>
          {activeJob.status === 'running' && <button onClick={onRefreshJob} style={{ ...outlineBtn, marginTop: 8 }}>Обновить статус</button>}
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Массовая операция по отмеченным клиникам</div>
        <select value={action} onChange={(e) => { setAction(e.target.value); setPreview(null); }} style={{ ...inputStyle, marginBottom: 10 }}>
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по ИНН или названию" style={{ ...inputStyle, marginBottom: 8 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border-3)', borderRadius: 8, padding: 8 }}>
          {filtered.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Клиник нет.</div>}
          {filtered.map((c) => (
            <label key={c.inn} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, padding: '4px 2px' }}>
              <input type="checkbox" checked={!!picked[c.inn]} onChange={(e) => setPicked((p) => ({ ...p, [c.inn]: e.target.checked }))} />
              {c.name} <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{c.inn}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            onClick={async () => { if (pickedInns.length) setPreview(await onPrepare(action, pickedInns)); }}
            style={outlineBtn}
            disabled={!pickedInns.length}
          >
            Предпросмотр ({pickedInns.length})
          </button>
          {preview && (
            <button onClick={() => { onCommit(action, pickedInns); setPreview(null); setPicked({}); }} style={primaryBtn}>
              Применить к {preview.rows.filter((r) => r.ok).length} из {preview.rows.length}
            </button>
          )}
        </div>
      </div>

      {preview && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Предпросмотр: {preview.label}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {preview.rows.map((r) => (
              <div key={r.inn} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border-3)' }}>
                <span style={{ fontWeight: 700 }}>{r.name}</span>
                <span style={{ color: r.ok ? 'var(--accent-hover)' : 'var(--warn)', fontWeight: 700 }}>{r.ok ? (r.preview || 'применится') : `пропуск · ${r.why}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Прошлые операции</div>
        {reports.length === 0 && <EmptyState text="Массовых операций ещё не было." />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reports.map((r) => (
            <div key={r.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{r.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{r.at}</div>
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 4 }}>
                применено: {r.done.length} · пропущено: {r.skipped.length} · ошибок: {r.failed.length}
                {r.undoneAt && <span style={{ color: 'var(--text-caption)' }}> · отменено {r.undoneAt}</span>}
              </div>
              {r.undoable && !r.undoneAt && (
                <button onClick={() => onUndo(r.id)} style={{ ...outlineBtn, marginTop: 8, color: 'var(--error)', borderColor: 'var(--error-border)' }}>Откатить операцию</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Финансовая сводка (дашборд) ---

export interface FinancialSummary {
  mrr: number;
  arpa: number;
  activeSubscriptions: number;
  churnRate: number;
  tariffDemand: { tariffKey: string; tariffName: string; count: number }[];
  avgRolloutDays: number | null;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('ru-RU') + ' ₽';
}

export function FinancialSummaryCards({ financials }: { financials: FinancialSummary | null }) {
  if (!financials) return null;
  const cell: React.CSSProperties = { ...cardStyle, flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: 4 };
  const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-caption)' };
  const value: React.CSSProperties = { fontSize: 19, fontWeight: 800 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={cell}><span style={label}>MRR</span><span style={value}>{fmtMoney(financials.mrr)}</span></div>
        <div style={cell}><span style={label}>ARPA</span><span style={value}>{fmtMoney(financials.arpa)}</span></div>
        <div style={cell}><span style={label}>Активных подписок</span><span style={value}>{financials.activeSubscriptions}</span></div>
        <div style={cell}><span style={label}>Отток</span><span style={value}>{Math.round(financials.churnRate * 100)}%</span></div>
        <div style={cell}><span style={label}>Срок внедрения</span><span style={value}>{financials.avgRolloutDays != null ? `${financials.avgRolloutDays} дн.` : '—'}</span></div>
      </div>
      {financials.tariffDemand.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>Востребованность тарифов</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {financials.tariffDemand.map((t) => (
              <div key={t.tariffKey} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                <span>{t.tariffName}</span><span>{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Портфель (дашборд) и переключатель периода ---

export interface PortfolioSummary {
  clinicsCount: number;
  mrr: number;
  avgReadinessPct: number;
  auditsInPeriod: number;
  periodDays: number;
}

export const PERIOD_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: 'квартал' },
];

export function PeriodSwitcher({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {PERIOD_OPTIONS.map((o) => (
        <button key={o.days} onClick={() => onChange(o.days)} style={{
          ...outlineBtn,
          background: days === o.days ? 'var(--text-primary)' : 'transparent',
          color: days === o.days ? '#fff' : 'var(--text-primary)',
          borderColor: days === o.days ? 'var(--text-primary)' : 'var(--border-1)',
        }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PortfolioCards({ portfolio }: { portfolio: PortfolioSummary | null }) {
  if (!portfolio) return null;
  const cell: React.CSSProperties = { ...cardStyle, flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: 4 };
  const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-caption)' };
  const value: React.CSSProperties = { fontSize: 19, fontWeight: 800 };
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-caption)', marginBottom: 8 }}>Портфель</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={cell}><span style={label}>Клиник на платформе</span><span style={value}>{portfolio.clinicsCount}</span></div>
        <div style={cell}><span style={label}>MRR</span><span style={value}>{portfolio.mrr.toLocaleString('ru-RU')} ₽</span></div>
        <div style={cell}><span style={label}>Средняя готовность</span><span style={value}>{portfolio.avgReadinessPct}%</span></div>
        <div style={cell}><span style={label}>Обходов за {portfolio.periodDays} дней</span><span style={value}>{portfolio.auditsInPeriod}</span></div>
      </div>
    </div>
  );
}

// --- Каталог клиентов и пользователей (богатая карточка) ---

export interface RichClientRow {
  inn: string;
  name: string;
  createdAt: string;
  staffCount: number;
  stagesPaid: number;
  openCapa: number;
  branchesCount: number;
  tariffKey: string | null;
  tariffName: string | null;
  subscriptionStatus: 'none' | 'trial' | 'active' | 'expired' | 'cancelled';
  readinessPct: number;
  lastActivityAt: string | null;
  churnRisk: boolean;
}

type ClientFilter = 'all' | 'trial' | 'churn-risk' | 'branches';

function AddClinicModal({ onAdd, onClose }: { onAdd: (input: { inn: string; org: string; login: string; password: string; password2: string; fio: string }) => Promise<boolean>; onClose: () => void }) {
  const [inn, setInn] = useState('');
  const [org, setOrg] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [fio, setFio] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(16,32,31,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Добавить клинику</div>
        <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Название организации" style={inputStyle} />
        <input value={inn} onChange={(e) => setInn(e.target.value)} placeholder="ИНН" style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
        <input value={fio} onChange={(e) => setFio(e.target.value)} placeholder="ФИО администратора клиники" style={inputStyle} />
        <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Логин администратора" style={inputStyle} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Временный пароль" type="password" style={inputStyle} />
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={onClose} style={outlineBtn}>Отмена</button>
          <button
            style={primaryBtn}
            onClick={async () => {
              if (!inn.trim() || !org.trim() || !login.trim() || !password || !fio.trim()) return;
              const ok = await onAdd({ inn: inn.trim(), org: org.trim(), login: login.trim(), password, password2: password, fio: fio.trim() });
              if (ok) onClose();
            }}
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientCatalogTab({ clients, financials, portfolio, periodDays, onPeriodChange, canAddClinic, onAddClinic }: {
  clients: RichClientRow[]; financials: FinancialSummary | null; portfolio: PortfolioSummary | null;
  periodDays: number; onPeriodChange: (days: number) => void;
  canAddClinic: boolean; onAddClinic: (input: { inn: string; org: string; login: string; password: string; password2: string; fio: string }) => Promise<boolean>;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [showAdd, setShowAdd] = useState(false);

  const counts = {
    all: clients.length,
    trial: clients.filter((c) => c.subscriptionStatus === 'trial').length,
    'churn-risk': clients.filter((c) => c.churnRisk).length,
    branches: clients.filter((c) => c.branchesCount > 1).length,
  };
  const byFilter = clients.filter((c) => {
    if (filter === 'trial') return c.subscriptionStatus === 'trial';
    if (filter === 'churn-risk') return c.churnRisk;
    if (filter === 'branches') return c.branchesCount > 1;
    return true;
  });
  const filtered = byFilter.filter((c) => !q.trim() || c.inn.includes(q.trim()) || c.name.toLowerCase().includes(q.trim().toLowerCase()));

  const chip = (key: ClientFilter, label: string): React.CSSProperties => ({
    padding: '8px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
    background: filter === key ? 'var(--text-primary)' : 'var(--bg-card)',
    color: key === 'churn-risk' && filter !== key ? 'var(--error)' : filter === key ? '#fff' : 'var(--text-primary)',
    border: `1px solid ${filter === key ? 'var(--text-primary)' : 'var(--border-1)'}`,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <PeriodSwitcher days={periodDays} onChange={onPeriodChange} />
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/api/panel/clients/export" download="clients.csv" style={{ ...outlineBtn, textDecoration: 'none', display: 'inline-block' }}>Выгрузить отчёт</a>
          {canAddClinic && <button onClick={() => setShowAdd(true)} style={primaryBtn}>+ Добавить клинику</button>}
        </div>
      </div>

      <PortfolioCards portfolio={portfolio} />
      <FinancialSummaryCards financials={financials} />

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')} style={chip('all', '')}>Все клиники · {counts.all}</button>
        <button onClick={() => setFilter('trial')} style={chip('trial', '')}>Trial · {counts.trial}</button>
        <button onClick={() => setFilter('churn-risk')} style={chip('churn-risk', '')}>Риск оттока · {counts['churn-risk']}</button>
        <button onClick={() => setFilter('branches')} style={chip('branches', '')}>Сети с филиалами · {counts.branches}</button>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по ИНН, названию или городу" style={inputStyle} />
      {filtered.length === 0 && <EmptyState text="Клиник по этому фильтру нет." />}
      {filtered.map((c) => (
        <div key={c.inn} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{c.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>ИНН {c.inn} · с {c.createdAt}</div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11.5, fontWeight: 700, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>{c.tariffName ?? 'без тарифа'}</span>
            {c.branchesCount > 0 && <span>Филиалов: {c.branchesCount}</span>}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Готовность
              <span style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--bg-app)', overflow: 'hidden', display: 'inline-block' }}>
                <span style={{ display: 'block', height: '100%', width: `${c.readinessPct}%`, background: c.readinessPct >= 70 ? 'var(--accent-hover)' : c.readinessPct >= 35 ? 'var(--warn)' : 'var(--error)' }} />
              </span>
              {c.readinessPct}%
            </span>
            <span style={{ color: c.churnRisk ? 'var(--error)' : 'var(--text-muted)' }}>{c.lastActivityAt ?? 'ещё не заходили'}</span>
            <span style={{ color: c.openCapa > 0 ? 'var(--error)' : 'var(--text-muted)' }}>CAPA: {c.openCapa}</span>
          </div>
        </div>
      ))}

      {showAdd && <AddClinicModal onAdd={onAddClinic} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
