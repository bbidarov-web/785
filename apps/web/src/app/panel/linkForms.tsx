'use client';

import { useEffect, useState } from 'react';
import type { StageDraft } from './catalogForms';

/**
 * Связка «кабинет клиники ↔ платформа»: счета, которые клиника заказала в
 * своём кабинете (подтверждение оплаты, приёмка этапа), и выдача документов
 * клинике — без неё этап оплачен, а документы в кабинете клиники так и висят
 * «ожидает выдачи» (шаблон отдаётся только при активной записи выдачи).
 */

const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '14px 16px' };
const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border-1)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, width: '100%' };
const primaryBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' };
const outlineBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 7, border: '1px solid var(--border-1)', background: 'transparent', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };

export interface StagePaymentRow {
  tenantInn: string;
  tenantName: string;
  stageCode: number;
  stageName: string;
  payment: { status: 'none' | 'pending' | 'paid'; amount: number; requestedAt: string | null; confirmedAt: string | null; accepted: boolean };
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ background: 'var(--bg-card)', border: '1px dashed #cfd8d7', borderRadius: 12, padding: 24, textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.5 }}>{text}</div>;
}

export function StagePaymentsList({ rows, canConfirm, canAccept, onConfirm, onAccept }: {
  rows: StagePaymentRow[]; canConfirm: boolean; canAccept: boolean;
  onConfirm: (inn: string, code: number) => void; onAccept: (inn: string, code: number) => void;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>Счета клиник</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>
        Этапы, которые клиники заказали в своём кабинете. Оплата от 100 000 ₽ уходит на подтверждение второй рукой.
      </div>
      {rows.length === 0 && <EmptyState text="Клиники пока не заказывали оплату этапов." />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => {
          const p = r.payment;
          const state = p.status === 'pending' ? 'ждёт подтверждения оплаты' : p.accepted ? 'оплачен и принят' : 'оплачен · ждёт приёмки';
          return (
            <div key={`${r.tenantInn}|${r.stageCode}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--border-3)' }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{r.tenantName} · этап {r.stageCode} «{r.stageName}»</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                  ИНН {r.tenantInn} · {p.amount.toLocaleString('ru-RU')} ₽ · {state}{p.requestedAt ? ` · счёт от ${p.requestedAt}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {p.status === 'pending' && canConfirm && <button onClick={() => onConfirm(r.tenantInn, r.stageCode)} style={primaryBtn}>Подтвердить оплату</button>}
                {p.status === 'paid' && !p.accepted && canAccept && <button onClick={() => onAccept(r.tenantInn, r.stageCode)} style={primaryBtn}>Принять этап</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface GrantRow { paid: boolean; byRole: string | null }

export function DocumentGrantsTab({ clients, stages, payments, onLoadGrants, onGrant, onRevoke }: {
  clients: { inn: string; name: string }[]; stages: StageDraft[]; payments: StagePaymentRow[];
  onLoadGrants: (inn: string) => Promise<Record<string, GrantRow>>;
  onGrant: (inn: string, stage: number, name: string, paid: boolean) => Promise<void>;
  onRevoke: (inn: string, stage: number, name: string) => Promise<void>;
}) {
  const [inn, setInn] = useState('');
  const [grants, setGrants] = useState<Record<string, GrantRow>>({});
  const reload = async (target: string) => setGrants(target ? await onLoadGrants(target) : {});
  useEffect(() => { void reload(inn); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [inn]);

  const stagePaid = (code: number) => payments.some((p) => p.tenantInn === inn && p.stageCode === code && p.payment.status === 'paid');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>Выдача документов клинике</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>
          Оплата этапа открывает состав, но шаблон клинике отдаёт человек — пока документ не выдан, в кабинете клиники он «ожидает выдачи».
          Выдача без оплаты этапа — операция второй руки.
        </div>
        <select value={inn} onChange={(e) => setInn(e.target.value)} style={inputStyle}>
          <option value="">— выберите клинику —</option>
          {clients.map((c) => <option key={c.inn} value={c.inn}>{c.name} · {c.inn}</option>)}
        </select>
      </div>
      {inn && stages.length === 0 && <EmptyState text="Каталог этапов ещё не опубликован методистом." />}
      {inn && stages.map((st) => {
        const paid = stagePaid(st.code);
        const docs = st.blocks.flatMap((b) => b.docs.map((d) => ({ block: b.name, name: d.name })));
        return (
          <div key={st.code} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>Этап {st.code} · {st.name}</div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, color: paid ? 'var(--accent-hover)' : 'var(--warn)', background: paid ? 'var(--accent-bg-light)' : 'var(--warn-bg)' }}>
                {paid ? 'этап оплачен' : 'этап не оплачен'}
              </span>
            </div>
            {docs.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>В этапе нет документов.</div>}
            {docs.map((d) => {
              const g = grants[d.name];
              return (
                <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-3)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{d.name} <span style={{ color: 'var(--text-muted)' }}>· {d.block}</span></div>
                  {g ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent-hover)' }}>выдан{g.paid ? '' : ' без оплаты'}</span>
                      <button onClick={async () => { await onRevoke(inn, st.code, d.name); await reload(inn); }} style={outlineBtn}>Отозвать</button>
                    </div>
                  ) : (
                    <button onClick={async () => { await onGrant(inn, st.code, d.name, paid); await reload(inn); }} style={paid ? primaryBtn : outlineBtn}>
                      {paid ? 'Выдать' : 'Выдать без оплаты'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
