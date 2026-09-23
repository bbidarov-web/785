'use client';

import { useState } from 'react';

const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '14px 16px' };
const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border-1)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, width: '100%' };
const primaryBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' };
const outlineBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 7, border: '1px solid var(--border-1)', background: 'transparent', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px dashed #cfd8d7', borderRadius: 12, padding: 24, textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.5 }}>
      {text}
    </div>
  );
}

export interface QueueTask {
  id: string;
  category: 'money' | 'audit';
  severity: 'критично' | 'важно';
  title: string;
  detail: string;
  tenantInn: string;
  tenantName: string;
  state: 'new' | 'in_progress' | 'postponed' | 'closed';
  stateBy: string | null;
  stateAt: string | null;
}

export interface DigestSettings {
  recipientEmail: string;
  schedule: string;
  lastSentAt: string | null;
}

type QueueFilter = 'active' | 'money' | 'in_progress' | 'postponed';

/**
 * Очередь работы (README «Очередь работы»): каждая просрочка — задача с
 * состоянием, общим для всех операторов платформы — одну клинику не
 * обзвонят дважды. Список пересчитывается из реальных данных на сервере,
 * здесь только отображение и действия (взять/отложить/закрыть).
 */
export function WorkQueueTab({ tasks, digestSettings, onTake, onPostpone, onClose, onSaveDigestSettings, onSendDigestNow }: {
  tasks: QueueTask[];
  digestSettings: DigestSettings | null;
  onTake: (id: string) => void;
  onPostpone: (id: string) => void;
  onClose: (id: string) => void;
  onSaveDigestSettings: (recipientEmail: string, schedule: string) => void;
  onSendDigestNow: () => void;
}) {
  const [filter, setFilter] = useState<QueueFilter>('active');
  const [email, setEmail] = useState(digestSettings?.recipientEmail ?? '');
  const [schedule, setSchedule] = useState(digestSettings?.schedule ?? 'каждое утро, 09:00');

  const active = tasks.filter((t) => t.state === 'new' || t.state === 'in_progress');
  const counts = {
    active: active.length,
    money: active.filter((t) => t.category === 'money').length,
    in_progress: tasks.filter((t) => t.state === 'in_progress').length,
    postponed: tasks.filter((t) => t.state === 'postponed').length,
  };
  const visible = tasks.filter((t) => {
    if (filter === 'active') return t.state === 'new' || t.state === 'in_progress';
    if (filter === 'money') return t.category === 'money' && (t.state === 'new' || t.state === 'in_progress');
    if (filter === 'in_progress') return t.state === 'in_progress';
    return t.state === 'postponed';
  });

  const chip = (key: QueueFilter): React.CSSProperties => ({
    padding: '8px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
    background: filter === key ? 'var(--text-primary)' : 'var(--bg-card)',
    color: filter === key ? '#fff' : 'var(--text-primary)',
    border: `1px solid ${filter === key ? 'var(--text-primary)' : 'var(--border-1)'}`,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...cardStyle, fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.5 }}>
        Каждая просрочка — задача с состоянием: взял в работу, отложил, закрыл. Состояние общее для всех операторов,
        поэтому одну клинику не обзвонят дважды. Отложенная задача возвращается в очередь через 3 дня, закрытая — на
        следующий день, если причина так и не исчезла.
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>Сводка за сутки · {counts.active}</div>
          <button onClick={onSendDigestNow} style={primaryBtn}>Отправить дайджест сейчас</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Получатель сводки" style={{ ...inputStyle, flex: '1 1 220px' }} />
          <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="Расписание" style={{ ...inputStyle, flex: '1 1 180px' }} />
          <button onClick={() => onSaveDigestSettings(email, schedule)} style={outlineBtn}>Сохранить</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginTop: 8 }}>
          {digestSettings?.lastSentAt ? `Последний раз отправлено ${digestSettings.lastSentAt}` : 'Дайджест ещё не отправлялся — проверьте получателя и расписание'}
          . Автоматическая отправка по расписанию не подключена — только вручную (см. README «Что дальше»).
        </div>
      </div>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('money')} style={chip('money')}>Деньги · {counts.money}</button>
        <button onClick={() => setFilter('active')} style={chip('active')}>Новые и в работе · {counts.active}</button>
        <button onClick={() => setFilter('in_progress')} style={chip('in_progress')}>Взято в работу · {counts.in_progress}</button>
        <button onClick={() => setFilter('postponed')} style={chip('postponed')}>Отложено · {counts.postponed}</button>
      </div>

      {visible.length === 0 && <EmptyState text="По этому фильтру задач нет." />}
      {visible.map((t) => (
        <div key={t.id} style={cardStyle}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 5, color: t.severity === 'критично' ? 'var(--error)' : 'var(--warn)', background: t.severity === 'критично' ? 'var(--error-bg)' : 'var(--warn-bg)' }}>{t.severity}</span>
            {t.state === 'in_progress' && <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 5, color: 'var(--accent-hover)', background: 'var(--accent-bg-light)' }}>в работе</span>}
            {t.state === 'postponed' && <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 5, color: 'var(--text-caption)', background: 'var(--bg-app)' }}>отложено</span>}
            <span style={{ fontSize: 13, fontWeight: 800 }}>{t.tenantName}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{t.detail} · ИНН {t.tenantInn}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {t.state !== 'in_progress' && <button onClick={() => onTake(t.id)} style={primaryBtn}>Взять в работу</button>}
            {t.state !== 'postponed' && <button onClick={() => onPostpone(t.id)} style={outlineBtn}>Отложить</button>}
            <button onClick={() => onClose(t.id)} style={{ ...outlineBtn, color: 'var(--accent-hover)' }}>Закрыть</button>
          </div>
        </div>
      ))}
    </div>
  );
}
