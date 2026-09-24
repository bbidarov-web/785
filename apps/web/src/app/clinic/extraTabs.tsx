'use client';

import { useEffect, useState } from 'react';

const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '14px 16px' };
const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border-1)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, width: '100%' };
const primaryBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' };
const outlineBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 7, border: '1px solid var(--border-1)', background: 'transparent', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };

export function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px dashed #cfd8d7', borderRadius: 12, padding: 24, textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.5 }}>
      {text}
    </div>
  );
}

// --- Реквизиты клиники ---
export interface ClinicProfile {
  orgFull: string;
  orgShort: string;
  license: string;
  chiefDoctor: string;
  city: string;
}

export function ProfileTab({ profile, canManage, onSave }: { profile: ClinicProfile; canManage: boolean; onSave: (next: ClinicProfile) => void }) {
  const [draft, setDraft] = useState<ClinicProfile>(profile);
  useEffect(() => setDraft(profile), [profile.orgFull, profile.orgShort, profile.license, profile.chiefDoctor, profile.city]);

  const fields: { key: keyof ClinicProfile; label: string; tag: string }[] = [
    { key: 'orgFull', label: 'Полное наименование по лицензии', tag: '{{org}}' },
    { key: 'orgShort', label: 'Краткое наименование', tag: '—' },
    { key: 'license', label: 'Номер лицензии', tag: '{{license}}' },
    { key: 'chiefDoctor', label: 'Руководитель (подписант)', tag: '{{chief_doctor}}' },
    { key: 'city', label: 'Город для шапки документов', tag: '{{city}}' },
  ];

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>Реквизиты, виды работ, филиалы и кабинеты — источник всех переменных</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 12 }}>
        Эти значения подставляются в шаблоны документов вместо переменных, отмеченных справа от поля.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {fields.map((f) => (
          <div key={f.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>{f.label}</div>
              <input
                value={draft[f.key]}
                disabled={!canManage}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-caption)', whiteSpace: 'nowrap' }}>{f.tag}</span>
          </div>
        ))}
      </div>
      {canManage && <button onClick={() => onSave(draft)} style={{ ...primaryBtn, marginTop: 12 }}>Сохранить реквизиты</button>}
    </div>
  );
}

// --- Опись документов ---
export interface InventoryRow {
  stageCode: number | null;
  zone: string;
  name: string;
  filled: boolean;
  filledLabel: string;
  filledAt: string | null;
  required: boolean;
}

export interface InventorySummary {
  total: number;
  filled: number;
  notFilled: number;
}

export function InventoryTab({ rows, summary }: { rows: InventoryRow[]; summary: InventorySummary }) {
  const [q, setQ] = useState('');
  const [onlyNotFilled, setOnlyNotFilled] = useState(false);
  const filtered = rows.filter((r) => {
    if (onlyNotFilled && r.filled) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return r.name.toLowerCase().includes(s) || r.zone.toLowerCase().includes(s);
  });
  const zones = [...new Set(filtered.map((r) => r.zone))];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>Опись документов · контрольный лист</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>
          документов: {summary.total} · заполнено: {summary.filled} · не заполнено: {summary.notFilled}
        </div>
        <button onClick={() => window.open('/api/clinic/documents/inventory/pdf', '_blank')} style={outlineBtn}>Печать описи (.pdf)</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию или разделу" style={{ ...inputStyle, flex: '1 1 260px' }} />
        <button
          onClick={() => setOnlyNotFilled((v) => !v)}
          style={{ padding: '9px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', background: onlyNotFilled ? 'var(--text-primary)' : 'var(--bg-card)', color: onlyNotFilled ? '#fff' : 'var(--text-primary)', border: `1px solid ${onlyNotFilled ? 'var(--text-primary)' : 'var(--border-1)'}` }}
        >
          {onlyNotFilled ? 'Показаны: не заполнены' : 'Все'}
        </button>
      </div>
      {filtered.length === 0 && <EmptyState text="По этому фильтру документов нет." />}
      {zones.map((zone) => (
        <div key={zone} style={cardStyle}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>{zone}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.filter((r) => r.zone === zone).map((r) => (
              <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-3)' }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {r.name} {r.required && <span style={{ color: 'var(--error)' }}>*</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {r.filledAt && <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600 }}>{r.filledAt}</span>}
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, color: r.filled ? 'var(--accent-hover)' : 'var(--warn)', background: r.filled ? 'var(--accent-bg-light)' : 'var(--warn-bg)' }}>
                    {r.filledLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Филиалы ---
export interface Branch {
  id: string;
  name: string;
}

export function BranchesTab({ branches, canManage, onAdd, onRemove }: {
  branches: Branch[]; canManage: boolean; onAdd: (name: string) => void; onRemove: (id: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Филиалы</div>
      {branches.length === 0 && <EmptyState text="Филиалы ещё не добавлены — считается, что клиника ведёт систему качества по одному объекту." />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {branches.map((b) => (
          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-3)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{b.name}</div>
            {canManage && <button onClick={() => onRemove(b.id)} style={outlineBtn}>Удалить</button>}
          </div>
        ))}
      </div>
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название филиала" style={{ ...inputStyle, flex: '1 1 220px' }} />
          <button onClick={() => { if (name.trim()) { onAdd(name); setName(''); } }} style={primaryBtn}>Добавить</button>
        </div>
      )}
    </div>
  );
}

// --- Годовой цикл ---
export interface CycleDirectionView {
  name: string;
  months: number[];
  check: string;
  object: string;
  branch: string;
  who: string;
}

const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function CycleTab({ year, dirs, staff, canManage, onCustomize, onGenerate }: {
  year: number | null; dirs: CycleDirectionView[]; staff: { fio: string }[]; canManage: boolean;
  onCustomize: (name: string, patch: { months?: number[]; check?: string; who?: string; object?: string; branch?: string }) => void;
  onGenerate: () => void;
}) {
  if (year === null) return <EmptyState text="Годовой цикл ещё не опубликован методистом." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800 }}>Годовой цикл {year}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>
          Эталон методиста: направления и месяцы проверок. Донастройте чек-лист и ответственного, затем соберите план.
        </div>
        {canManage && <button onClick={onGenerate} style={{ ...primaryBtn, marginTop: 10 }}>Собрать план проверок из цикла</button>}
      </div>
      {dirs.map((d) => (
        <CycleDirectionRow key={d.name} dir={d} staff={staff} canManage={canManage} onCustomize={onCustomize} />
      ))}
    </div>
  );
}

function CycleDirectionRow({ dir, staff, canManage, onCustomize }: {
  dir: CycleDirectionView; staff: { fio: string }[]; canManage: boolean;
  onCustomize: (name: string, patch: { months?: number[]; check?: string; who?: string }) => void;
}) {
  const [check, setCheck] = useState(dir.check);
  const [who, setWho] = useState(dir.who);
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13, fontWeight: 800 }}>{dir.name}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>
        Месяцы: {dir.months.map((m) => MONTH_NAMES[m]).join(', ') || 'не заданы'}
      </div>
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input value={check} onChange={(e) => setCheck(e.target.value)} placeholder="Чек-лист из каталога" style={{ ...inputStyle, flex: '1 1 220px' }} />
          <select value={who} onChange={(e) => setWho(e.target.value)} style={{ ...inputStyle, flex: '1 1 160px' }}>
            <option value="">Ответственный</option>
            {staff.map((s) => <option key={s.fio} value={s.fio}>{s.fio}</option>)}
          </select>
          <button onClick={() => onCustomize(dir.name, { check, who })} style={outlineBtn}>Сохранить</button>
        </div>
      )}
    </div>
  );
}

// --- Оборудование ---
export interface EquipmentPosition {
  uid: string;
  name: string;
  room?: string;
  type?: string;
  logWho?: Record<string, string>;
}

export interface EquipmentTypeDef {
  key: string;
  name: string;
  logs: { name: string; freq: string; kind: string }[];
}

export interface EquipmentFormRow {
  posUid: string;
  posName: string;
  room: string;
  formName: string;
  freq: string;
  kind: string;
  who: string;
  dueNow: boolean;
  lastFill: { date?: string; value?: string; note?: string } | null;
}

export function EquipmentTab({ positions, types, forms, canManage, onAddPosition, onRemovePosition, onFill }: {
  positions: EquipmentPosition[]; types: EquipmentTypeDef[]; forms: EquipmentFormRow[]; canManage: boolean;
  onAddPosition: (input: { name: string; room: string; type: string }) => void;
  onRemovePosition: (uid: string) => void;
  onFill: (posUid: string, formName: string, value: string, note: string) => void;
}) {
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [type, setType] = useState(types[0]?.key ?? '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Позиции оборудования</div>
        {positions.length === 0 && <EmptyState text="Оборудование ещё не заведено." />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {positions.map((p) => (
            <div key={p.uid} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-3)' }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{p.room} · {types.find((t) => t.key === p.type)?.name ?? p.type}</div>
              </div>
              {canManage && <button onClick={() => onRemovePosition(p.uid)} style={outlineBtn}>Удалить</button>}
            </div>
          ))}
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название позиции" style={{ ...inputStyle, flex: '1 1 200px' }} />
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Кабинет" style={{ ...inputStyle, flex: '1 1 160px' }} />
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px' }}>
              {types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <button onClick={() => { if (name.trim()) { onAddPosition({ name, room, type }); setName(''); setRoom(''); } }} style={primaryBtn}>Добавить</button>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Формы к заполнению</div>
        {forms.length === 0 && <EmptyState text="Форм не назначено." />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {forms.map((f) => (
            <EquipmentFormRowView key={`${f.posUid}|${f.formName}`} form={f} onFill={onFill} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EquipmentFormRowView({ form, onFill }: { form: EquipmentFormRow; onFill: (posUid: string, formName: string, value: string, note: string) => void }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  return (
    <div style={{ border: '1px solid var(--border-2)', borderRadius: 9, padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{form.formName} · {form.posName}</div>
        <span style={{ fontSize: 10, fontWeight: 700, color: form.dueNow ? 'var(--error)' : 'var(--accent-hover)' }}>{form.dueNow ? 'пора заполнить' : 'заполнено'}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>
        {form.room} · {form.freq} · ответственный: {form.who}
        {form.lastFill?.date && ` · последняя запись ${form.lastFill.date}${form.lastFill.value ? ' · ' + form.lastFill.value : ''}`}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Показание / значение" style={{ ...inputStyle, flex: '1 1 160px' }} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Примечание" style={{ ...inputStyle, flex: '1 1 160px' }} />
        <button onClick={() => { onFill(form.posUid, form.formName, value, note); setValue(''); setNote(''); }} style={outlineBtn}>Заполнить</button>
      </div>
    </div>
  );
}

// --- Сводный отчёт ---
export interface SummaryRow {
  name: string;
  note: string;
  required: boolean;
  file: { fileName: string; date: string } | null;
}

export function SummaryTab({ rows, canManage, onUpload, onRemove }: {
  rows: SummaryRow[]; canManage: boolean; onUpload: (name: string, fileName: string, base64: string) => void; onRemove: (name: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.length === 0 && <EmptyState text="Эталон сводного отчёта методистом пока не опубликован." />}
      {rows.map((r) => (
        <div key={r.name} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{r.name}</div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, color: r.required ? 'var(--error)' : 'var(--text-muted)', background: r.required ? 'var(--error-bg)' : 'var(--bg-app)' }}>
              {r.required ? 'обязательный' : 'по желанию'}
            </span>
          </div>
          {r.note && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{r.note}</div>}
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: r.file ? 'var(--accent-hover)' : 'var(--warn)' }}>
            {r.file ? `Загружен: ${r.file.fileName} · ${r.file.date}` : 'Не загружен'}
          </div>
          {canManage && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="k785-tap-target" style={{ ...outlineBtn, cursor: 'pointer' }}>
                Загрузить файл
                <input
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => onUpload(r.name, f.name, String(reader.result || ''));
                    reader.readAsDataURL(f);
                  }}
                />
              </label>
              {r.file && <button onClick={() => onRemove(r.name)} style={outlineBtn}>Удалить файл</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Самообследование ---
export interface SelfAuditItemView {
  text: string;
  answer: '' | 'ok' | 'bad' | 'na';
  comment: string;
}

export interface SelfAuditRunView {
  checklistName: string;
  items: SelfAuditItemView[];
  finished: boolean;
  date: string;
}

export function SelfAuditTab({ runs, catalog, canManage, onStart, onAnswer, onFinish, onExport }: {
  runs: SelfAuditRunView[]; catalog: string[]; canManage: boolean;
  onStart: (name: string) => void;
  onAnswer: (name: string, index: number, answer: 'ok' | 'bad' | 'na', comment: string) => void;
  onFinish: (name: string) => void;
  onExport: () => void;
}) {
  const [picked, setPicked] = useState(catalog[0] ?? '');
  const started = new Set(runs.map((r) => r.checklistName));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', maxWidth: 520 }}>
          Проверка себя по листам, которыми пользуется надзор — соответствует / не соответствует / не применимо.
          Несоответствия автоматически становятся корректирующими мероприятиями.
        </div>
        <button onClick={onExport} style={outlineBtn}>Выгрузить пакет для инспектора</button>
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={picked} onChange={(e) => setPicked(e.target.value)} style={{ ...inputStyle, flex: '1 1 260px' }}>
            {catalog.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => picked && onStart(picked)} style={primaryBtn} disabled={started.has(picked)}>
            {started.has(picked) ? 'Уже начато' : 'Начать прогон'}
          </button>
        </div>
      )}

      {runs.length === 0 && <EmptyState text="Прогонов самообследования ещё нет." />}
      {runs.map((run) => (
        <SelfAuditRunCard key={run.checklistName} run={run} canManage={canManage} onAnswer={onAnswer} onFinish={onFinish} />
      ))}
    </div>
  );
}

function SelfAuditRunCard({ run, canManage, onAnswer, onFinish }: {
  run: SelfAuditRunView; canManage: boolean;
  onAnswer: (name: string, index: number, answer: 'ok' | 'bad' | 'na', comment: string) => void;
  onFinish: (name: string) => void;
}) {
  const allAnswered = run.items.every((it) => it.answer);
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{run.checklistName}</div>
        <span style={{ fontSize: 10, fontWeight: 700, color: run.finished ? 'var(--accent-hover)' : 'var(--warn)' }}>{run.finished ? `завершено ${run.date}` : 'в работе'}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {run.items.map((it, i) => (
          <SelfAuditItemRow key={i} item={it} disabled={run.finished || !canManage} onAnswer={(a, c) => onAnswer(run.checklistName, i, a, c)} />
        ))}
      </div>
      {!run.finished && canManage && (
        <button onClick={() => onFinish(run.checklistName)} disabled={!allAnswered} style={{ ...primaryBtn, marginTop: 10, opacity: allAnswered ? 1 : 0.5 }}>
          Завершить прогон
        </button>
      )}
    </div>
  );
}

function SelfAuditItemRow({ item, disabled, onAnswer }: { item: SelfAuditItemView; disabled: boolean; onAnswer: (a: 'ok' | 'bad' | 'na', c: string) => void }) {
  const [comment, setComment] = useState(item.comment);
  return (
    <div style={{ border: '1px solid var(--border-2)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{item.text}</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {(['ok', 'bad', 'na'] as const).map((a) => (
          <button key={a} disabled={disabled} onClick={() => onAnswer(a, comment)}
            style={{
              padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              border: `1px solid ${item.answer === a ? 'var(--accent)' : 'var(--border-1)'}`,
              background: item.answer === a ? 'var(--accent)' : '#fff', color: item.answer === a ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {a === 'ok' ? 'соответствует' : a === 'bad' ? 'не соответствует' : 'не применимо'}
          </button>
        ))}
      </div>
      {item.answer === 'bad' && (
        <input
          value={comment}
          disabled={disabled}
          onChange={(e) => setComment(e.target.value)}
          onBlur={() => onAnswer('bad', comment)}
          placeholder="Чем подтверждается несоответствие"
          style={{ ...inputStyle, marginTop: 6 }}
        />
      )}
    </div>
  );
}
