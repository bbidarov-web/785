'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  EquipmentTab, SummaryTab,
  type EquipmentPosition, type EquipmentTypeDef, type EquipmentFormRow, type SummaryRow,
} from '../clinic/extraTabs';

/**
 * Мобильный обход — перенос сценариев «Аудиты», «Оборудование» и «Сводный
 * отчёт» из reference/prototype/Обход - мобильный.dc.html: главный экран с
 * тремя разделами → внутри раздела свой сценарий (чек-лист с ответами для
 * аудитов, формы журналов для оборудования, статус загрузки для сводного
 * отчёта). Оборудование и сводный отчёт используют ТЕ ЖЕ эндпоинты и права,
 * что и `/clinic` (`EquipmentService`/`SummaryService`, `apps/api/src/http/routes/clinicExtras.ts`)
 * — сервер не различает, откуда пришёл запрос, только роль в сессии:
 * управлять позициями оборудования и загружать сводный отчёт может только
 * `vkk_lead` (право `doc:write`), медсестра донабирает журналы (`journal:write`
 * на свои назначенные формы), аудитор эти два раздела только просматривает
 * (ведёт проверки, но не журналы — дословно по матрице ROLES).
 *
 * Офлайн-очередь (SERVER.md §6.5) — только для раздела «Аудиты»: каждая
 * правка получает свой opId в момент постановки в очередь, до попытки
 * отправки. Пока нет сети — правки копятся в localStorage и уходят по одной
 * при её появлении; повтор с тем же opId сервер не применит дважды (see
 * apps/api/src/walk/service.ts, ChannelStore.set opId). Оборудование и
 * сводный отчёт офлайн-очередь пока не используют — это отдельные экраны с
 * собственными формами, требующими подключения к сети сразу.
 */

interface SessionInfo {
  role: string;
  side: 'platform' | 'clinic';
  fio: string;
}

interface WalkListItem {
  planId: string;
  no: string;
  name: string;
  object: string;
  kind: string;
  owner: string;
  planDate: string;
  noCheck: boolean;
  noCheckNote: string;
  answered: number;
  total: number;
  bad: number;
  pct: number;
  finished: boolean;
  status: string;
}

interface WalkItemAnswer {
  index: number;
  text: string;
  answer: '' | 'ok' | 'bad';
  comment: string;
  hasPhoto: boolean;
  photoFileId: string | null;
}

interface WalkDetail extends WalkListItem {
  items: WalkItemAnswer[];
}

interface QueuedOp {
  opId: string;
  planId: string;
  body: { index: number; answer: 'ok' | 'bad'; comment?: string; photoBase64?: string };
}

const QUEUE_KEY = 'k785_walk_queue';
const ALLOWED_ROLES = ['auditor', 'nurse', 'vkk_lead'];
type View = 'sections' | 'audits' | 'equipment' | 'summary';

function loadQueue(): QueuedOp[] {
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) || '[]') || [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedOp[]): void {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* хранилище недоступно — очередь останется только в памяти вкладки */
  }
}

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1200;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * k));
        canvas.height = Math.max(1, Math.round(img.height * k));
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas недоступен'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => reject(new Error('не удалось прочитать изображение'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

export default function MobileWalkPage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [view, setView] = useState<View>('sections');
  const [list, setList] = useState<WalkListItem[] | null>(null);
  const [detail, setDetail] = useState<WalkDetail | null>(null);
  const [equipPositions, setEquipPositions] = useState<EquipmentPosition[]>([]);
  const [equipTypes, setEquipTypes] = useState<EquipmentTypeDef[]>([]);
  const [equipForms, setEquipForms] = useState<EquipmentFormRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  const loadList = useCallback(async () => {
    const r = await api.get<{ ok: true; walks: WalkListItem[] } | { ok: false; error: string }>('/api/walk/plan');
    if (r.ok) setList(r.walks);
  }, []);

  const loadEquipment = useCallback(async () => {
    const [pos, types, forms] = await Promise.all([
      api.get<{ ok: true; positions: EquipmentPosition[] } | { ok: false; error: string }>('/api/clinic/equipment/positions'),
      api.get<{ ok: true; types: EquipmentTypeDef[] }>('/api/panel/equip-types'),
      api.get<{ ok: true; forms: EquipmentFormRow[] } | { ok: false; error: string }>('/api/clinic/equipment/forms'),
    ]);
    if (pos.ok) setEquipPositions(pos.positions);
    if (types.ok) setEquipTypes(types.types);
    if (forms.ok) setEquipForms(forms.forms);
  }, []);

  const loadSummary = useCallback(async () => {
    const r = await api.get<{ ok: true; rows: SummaryRow[] } | { ok: false; error: string }>('/api/clinic/summary');
    if (r.ok) setSummaryRows(r.rows);
  }, []);

  const flushQueue = useCallback(async () => {
    const pending = loadQueue();
    if (!pending.length) return;
    const remaining: QueuedOp[] = [];
    for (const op of pending) {
      try {
        const r = await api.post<{ ok: boolean }>(`/api/walk/plan/${op.planId}/answer`, { ...op.body, opId: op.opId });
        if (!r.ok) remaining.push(op); // сервер ответил, но отклонил — не повторяем бесконечно молча
      } catch {
        remaining.push(op); // сети всё ещё нет — оставляем в очереди
      }
    }
    saveQueue(remaining);
    setQueue(remaining);
    if (remaining.length !== pending.length) {
      say(`Отправлено ${pending.length - remaining.length} ответ(ов). Журнал ВКК обновлён.`);
      await loadList();
    }
  }, [loadList, say]);

  // PWA только на этом экране (README «Что дальше»: «мобильный обход как PWA») — регистрация
  // здесь, а не в layout.tsx, чтобы установка приложения не касалась остальных кабинетов.
  // Сервис-воркер (public/sw.js) ничего не кэширует, нужен только для установки на экран.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {}); // недоступность SW не мешает работе страницы
    }
  }, []);

  useEffect(() => {
    (async () => {
      const r = await api.get<{ ok: true; session: SessionInfo | null }>('/api/auth/session');
      const ok = r.ok && r.session && ALLOWED_ROLES.includes(r.session.role);
      setSession(ok ? r.session : null);
      setReady(true);
      if (ok) await Promise.all([loadList(), loadEquipment(), loadSummary()]);
    })();
    setQueue(loadQueue());
    setOnline(navigator.onLine !== false);
    const onOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openWalk(planId: string) {
    const r = await api.get<{ ok: true; detail: WalkDetail } | { ok: false; error: string }>(`/api/walk/plan/${planId}`);
    if (!r.ok) {
      say(r.error);
      return;
    }
    setDetail(r.detail);
  }

  async function setAnswer(index: number, answer: 'ok' | 'bad', comment?: string, photoBase64?: string) {
    if (!detail) return;
    const opId = crypto.randomUUID();
    const body = { index, answer, comment, photoBase64 };

    // оптимистичное обновление экрана — не ждём сеть, чтобы палец не «залипал»
    setDetail((d) => {
      if (!d) return d;
      const items = d.items.slice();
      const prev = items[index];
      items[index] = { index, text: prev?.text ?? '', answer, comment: comment ?? prev?.comment ?? '', hasPhoto: !!photoBase64 || !!prev?.hasPhoto, photoFileId: prev?.photoFileId ?? null };
      const answered = items.filter((it) => it.answer).length;
      const bad = items.filter((it) => it.answer === 'bad').length;
      return { ...d, items, answered, bad, pct: Math.round((answered / d.total) * 100) };
    });

    if (!navigator.onLine) {
      const q = loadQueue().concat([{ opId, planId: detail.planId, body }]);
      saveQueue(q);
      setQueue(q);
      say('Офлайн: ответ сохранён на телефоне, отправим при появлении сети.');
      return;
    }
    try {
      const r = await api.post<{ ok: true; detail: WalkDetail } | { ok: false; error: string }>(`/api/walk/plan/${detail.planId}/answer`, { ...body, opId });
      if (r.ok) setDetail(r.detail);
      else say(r.error);
    } catch {
      const q = loadQueue().concat([{ opId, planId: detail.planId, body }]);
      saveQueue(q);
      setQueue(q);
      say('Сеть недоступна: ответ сохранён на телефоне, отправим при появлении сети.');
    }
  }

  async function attachPhoto(index: number, file: File) {
    try {
      const src = await resizeImage(file);
      const current = detail?.items[index];
      await setAnswer(index, current?.answer || 'ok', current?.comment, src);
      say('Снимок прикреплён к пункту ' + (index + 1));
    } catch {
      say('Не удалось обработать снимок');
    }
  }

  async function finishWalk() {
    if (!detail) return;
    if (detail.answered < detail.total) {
      say('Остались неотмеченные пункты — прокрутите список вверх.');
      return;
    }
    const r = await api.post<{ ok: true; bad: number; total: number } | { ok: false; error: string }>(`/api/walk/plan/${detail.planId}/finish`, { opId: crypto.randomUUID() });
    if (!r.ok) {
      say(r.error);
      return;
    }
    say(r.bad ? `Проверено ${r.total} пунктов, выявлено нарушений: ${r.bad}.` : `Проверено ${r.total} пунктов, нарушений не выявлено.`);
    setDetail(null);
    await loadList();
  }

  if (!ready) return null;

  if (!session) {
    return (
      <Shell title="Мобильный обход">
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Вход в обход выполняется через кабинет клиники. Обратитесь к ответственному за ВКК за назначением на проверку.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <a href="/clinic" style={{ fontSize: 13, fontWeight: 700 }}>Войти в кабинет клиники (ответственный, аудитор)</a>
          <a href="/executor" style={{ fontSize: 13, fontWeight: 700 }}>Войти как исполнитель (по телефону)</a>
        </div>
      </Shell>
    );
  }

  if (detail) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column' }}>
        <TopBar fio={session.fio} online={online} queueLen={queue.length} onBack={() => setDetail(null)} onFlush={flushQueue} />
        <div style={{ padding: '16px clamp(12px, 4vw, 22px) 100px', maxWidth: 680, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-1)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{detail.name}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginTop: 2 }}>{detail.object} · {detail.owner}</div>
          </div>

          {detail.noCheck && <EmptyState text={detail.noCheckNote} />}

          {detail.items.map((it) => (
            <div
              key={it.index}
              style={{
                background: 'var(--bg-card)',
                border: `1px solid ${it.answer === 'bad' ? '#f0d9d5' : it.answer === 'ok' ? '#cfe3e0' : 'var(--border-2)'}`,
                borderRadius: 11,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>{it.index + 1}. {it.text}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="k785-tap-target"
                  onClick={() => setAnswer(it.index, 'ok', it.comment)}
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${it.answer === 'ok' ? 'var(--accent)' : 'var(--border-1)'}`, background: it.answer === 'ok' ? 'var(--accent)' : '#fff', color: it.answer === 'ok' ? '#fff' : 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700 }}
                >
                  В норме
                </button>
                <button
                  className="k785-tap-target"
                  onClick={() => setAnswer(it.index, 'bad', it.comment)}
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${it.answer === 'bad' ? '#c8564a' : 'var(--border-1)'}`, background: it.answer === 'bad' ? '#c8564a' : '#fff', color: it.answer === 'bad' ? '#fff' : 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700 }}
                >
                  Нарушение
                </button>
              </div>
              {it.answer === 'bad' && (
                <textarea
                  value={it.comment}
                  onChange={(e) => setAnswer(it.index, 'bad', e.target.value)}
                  placeholder="Опишите нарушение — попадёт в акт и журнал"
                  style={{ padding: 11, border: '1px solid #e0b3ac', borderRadius: 9, background: '#fdf5f4', fontSize: 13, color: '#7c2b22', fontWeight: 600, lineHeight: 1.45, minHeight: 60, resize: 'vertical' }}
                />
              )}
              <label className="k785-tap-target" style={{ alignSelf: 'flex-start', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border-1)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                {it.hasPhoto ? '📷 Снимок прикреплён' : '📷 Прикрепить фото'}
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachPhoto(it.index, f); }} />
              </label>
            </div>
          ))}
        </div>
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px clamp(12px, 4vw, 22px) calc(12px + env(safe-area-inset-bottom))', background: 'var(--bg-app)', borderTop: '1px solid var(--border-1)' }}>
          <button
            className="k785-tap-target"
            onClick={finishWalk}
            style={{
              width: '100%', maxWidth: 680, margin: '0 auto', display: 'block', padding: 16, borderRadius: 12, border: 'none',
              background: detail.answered >= detail.total ? 'var(--accent)' : '#9fc9c4', color: '#fff', fontSize: 14.5, fontWeight: 800,
            }}
          >
            {detail.answered >= detail.total ? 'Завершить проверку' : `Отметьте все пункты (${detail.answered}/${detail.total})`}
          </button>
        </div>
        {toast && <Toast text={toast} />}
      </div>
    );
  }

  const auditsTotal = list?.length ?? 0;
  const auditsToWork = (list ?? []).filter((w) => !w.finished && !w.noCheck).length;
  const equipToWork = equipForms.filter((f) => f.dueNow).length;
  const summaryUploaded = summaryRows.filter((r) => r.file).length;
  const summaryToWork = summaryRows.filter((r) => r.required && !r.file).length;
  const canManageEquipment = session.role === 'vkk_lead';
  const canManageSummary = session.role === 'vkk_lead';

  if (view === 'sections') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column' }}>
        <TopBar fio={session.fio} online={online} queueLen={queue.length} onFlush={flushQueue} />
        <div style={{ padding: '16px clamp(12px, 4vw, 22px) 32px', maxWidth: 680, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Разделы</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Выберите раздел работы</div>
          <SectionCard no="01" title="Аудиты" desc="обходы по плану проверок, чек-листы и результаты"
            stat={`проверок: ${auditsTotal}`} badge={auditsToWork ? `к работе: ${auditsToWork}` : undefined} onClick={() => setView('audits')} />
          <SectionCard no="02" title="Оборудование" desc="журналы и чек-листы по позициям оборудования"
            stat={`форм: ${equipForms.length}`} badge={equipToWork ? `к работе: ${equipToWork}` : undefined} onClick={() => setView('equipment')} />
          <SectionCard no="03" title="Сводный отчёт" desc="итоговые документы клиники: состав от методиста"
            stat={`загружено ${summaryUploaded} из ${summaryRows.length}`} badge={summaryToWork ? `к работе: ${summaryToWork}` : undefined} onClick={() => setView('summary')} />
        </div>
        {toast && <Toast text={toast} />}
      </div>
    );
  }

  if (view === 'equipment') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column' }}>
        <TopBar fio={session.fio} online={online} queueLen={queue.length} onBack={() => setView('sections')} onFlush={flushQueue} />
        <div style={{ padding: '16px clamp(12px, 4vw, 22px) 32px', maxWidth: 680, width: '100%', margin: '0 auto' }}>
          <EquipmentTab
            positions={equipPositions} types={equipTypes} forms={equipForms} canManage={canManageEquipment} branches={[]}
            onAddPosition={async (input) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>('/api/clinic/equipment/positions', input);
              if (!r.ok) { say(r.error); return; }
              await loadEquipment(); say('Позиция добавлена');
            }}
            onRemovePosition={async (uid) => {
              const r = await api.del<{ ok: true } | { ok: false; error: string }>(`/api/clinic/equipment/positions/${uid}`);
              if (!r.ok) { say(r.error); return; }
              await loadEquipment(); say('Позиция удалена');
            }}
            onFill={async (posUid, formName, value, note) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/clinic/equipment/positions/${posUid}/forms/${encodeURIComponent(formName)}/fill`, { value, note, source: 'обход' });
              if (!r.ok) { say(r.error); return; }
              await loadEquipment(); say('Форма заполнена');
            }}
          />
        </div>
        {toast && <Toast text={toast} />}
      </div>
    );
  }

  if (view === 'summary') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column' }}>
        <TopBar fio={session.fio} online={online} queueLen={queue.length} onBack={() => setView('sections')} onFlush={flushQueue} />
        <div style={{ padding: '16px clamp(12px, 4vw, 22px) 32px', maxWidth: 680, width: '100%', margin: '0 auto' }}>
          <SummaryTab
            rows={summaryRows} canManage={canManageSummary}
            onUpload={async (name, fileName, base64) => {
              const r = await api.post<{ ok: true } | { ok: false; error: string }>(`/api/clinic/summary/${encodeURIComponent(name)}/upload`, { fileName, base64 });
              if (!r.ok) { say(r.error); return; }
              await loadSummary(); say('Файл загружен');
            }}
            onRemove={async (name) => {
              const r = await api.del<{ ok: true } | { ok: false; error: string }>(`/api/clinic/summary/${encodeURIComponent(name)}`);
              if (!r.ok) { say(r.error); return; }
              await loadSummary(); say('Файл удалён');
            }}
          />
        </div>
        {toast && <Toast text={toast} />}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column' }}>
      <TopBar fio={session.fio} online={online} queueLen={queue.length} onBack={() => setView('sections')} onFlush={flushQueue} />
      <div style={{ padding: '16px clamp(12px, 4vw, 22px) 32px', maxWidth: 680, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list && list.length === 0 && <EmptyState text="Проверок на вас не назначено. Как только клиника поставит вас проверяющим в плане, они появятся здесь." />}
        {(list ?? []).map((w) => (
          <div key={w.planId} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{w.no} · {w.name}</div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, whiteSpace: 'nowrap', color: w.finished ? (w.bad ? 'var(--error)' : 'var(--accent-hover)') : 'var(--warn)', background: w.finished ? (w.bad ? 'var(--error-bg)' : 'var(--accent-bg-light)') : 'var(--warn-bg)' }}>
                {w.status}
              </span>
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>{w.object} · {w.kind} · срок {w.planDate || 'не задан'}</div>
            {w.noCheck ? (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--warn)' }}>{w.noCheckNote}</div>
            ) : (
              <button
                className="k785-tap-target"
                onClick={() => openWalk(w.planId)}
                style={{ alignSelf: 'flex-start', padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700 }}
              >
                {w.finished ? 'Открыть' : w.pct > 0 ? 'Продолжить' : 'Начать'} ({w.answered}/{w.total})
              </button>
            )}
          </div>
        ))}
      </div>
      {toast && <Toast text={toast} />}
    </div>
  );
}

function SectionCard({ no, title, desc, stat, badge, onClick }: { no: string; title: string; desc: string; stat: string; badge?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="k785-tap-target"
      style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 12, padding: '16px 18px', cursor: 'pointer' }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 9, background: 'var(--bg-app)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: 'var(--accent-hover)', flexShrink: 0 }}>{no}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{desc}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{stat}</span>
          {badge && <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 5, color: 'var(--error)', background: 'var(--error-bg)' }}>{badge}</span>}
        </div>
      </div>
      <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>›</span>
    </button>
  );
}

function TopBar({ fio, online, queueLen, onBack, onFlush }: { fio: string; online: boolean; queueLen: number; onBack?: () => void; onFlush: () => void }) {
  return (
    <div style={{ background: 'var(--sidebar-bg)', color: 'var(--sidebar-text)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {onBack && (
        <button onClick={onBack} className="k785-tap-target" style={{ background: 'transparent', border: 'none', color: 'var(--sidebar-text)', fontSize: 13, fontWeight: 700 }}>
          ← Список
        </button>
      )}
      <div style={{ fontSize: 13, fontWeight: 700, marginRight: 'auto' }}>{fio}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: online ? 'var(--accent-on-dark)' : '#e0b3ac' }}>{online ? 'сеть есть' : 'офлайн'}</div>
      {queueLen > 0 && (
        <button onClick={onFlush} className="k785-tap-target" style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #2c4442', background: 'transparent', color: 'var(--sidebar-text)', fontSize: 11, fontWeight: 700 }}>
          Не отправлено: {queueLen} · {online ? 'Отправить →' : 'ждём сеть'}
        </button>
      )}
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, background: 'var(--bg-card)', border: '1px solid var(--border-1)', borderRadius: 16, padding: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-caption)' }}>Контур 785</div>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: '4px 0 12px' }}>{title}</h1>
        {children}
        <Link href="/" style={{ display: 'inline-block', marginTop: 16, fontSize: 12.5, fontWeight: 700 }}>← на главную</Link>
      </div>
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

function Toast({ text }: { text: string }) {
  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 90, transform: 'translateX(-50%)', maxWidth: 520, background: 'var(--text-primary)', color: '#fff', padding: '12px 18px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, boxShadow: 'var(--shadow-toast)', zIndex: 40 }}>
      {text}
    </div>
  );
}
