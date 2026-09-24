'use client';

import { useEffect, useState } from 'react';

const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '14px 16px' };
const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--border-1)', borderRadius: 8, fontSize: 12.5, fontWeight: 600, width: '100%' };
const primaryBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' };
const outlineBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 7, border: '1px solid var(--border-1)', background: 'transparent', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' };
const dashedBtn: React.CSSProperties = { ...outlineBtn, borderStyle: 'dashed', color: 'var(--accent)' };

// --- Каталог этапов (stage_docs) ---

export interface StageDocDraft {
  name: string;
  template: string;
}
export interface StageBlockDraft {
  key: string;
  num: string;
  name: string;
  docs: StageDocDraft[];
}
export interface StageDraft {
  code: number;
  name: string;
  price: number;
  offerText?: string;
  offerFile?: string;
  blocks: StageBlockDraft[];
}

export function StageCatalogForm({ stages, canPublish, onPublish }: { stages: StageDraft[]; canPublish: boolean; onPublish: (next: StageDraft[]) => void }) {
  const [draft, setDraft] = useState<StageDraft[]>(stages);
  useEffect(() => setDraft(stages), [stages]);

  function updateStage(i: number, patch: Partial<StageDraft>) {
    setDraft((d) => d.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }
  function updateBlock(si: number, bi: number, patch: Partial<StageBlockDraft>) {
    setDraft((d) => d.map((s, j) => (j !== si ? s : { ...s, blocks: s.blocks.map((b, k) => (k === bi ? { ...b, ...patch } : b)) })));
  }
  function updateDoc(si: number, bi: number, di: number, patch: Partial<StageDocDraft>) {
    setDraft((d) => d.map((s, j) => (j !== si ? s : {
      ...s, blocks: s.blocks.map((b, k) => (k !== bi ? b : { ...b, docs: b.docs.map((doc, m) => (m === di ? { ...doc, ...patch } : doc)) })),
    })));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
        Этапы идут по порядку номера (код). Шаблон документа поддерживает переменные {'{{org}}'}, {'{{inn}}'}, {'{{date}}'}, {'{{responsible}}'}.
      </div>
      {draft.map((stage, si) => (
        <div key={si} style={cardStyle}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input type="number" value={stage.code} disabled={!canPublish} onChange={(e) => updateStage(si, { code: Number(e.target.value) })} placeholder="Код (порядок)" style={{ ...inputStyle, flex: '0 1 100px' }} />
            <input value={stage.name} disabled={!canPublish} onChange={(e) => updateStage(si, { name: e.target.value })} placeholder="Название этапа" style={{ ...inputStyle, flex: '1 1 220px' }} />
            <input type="number" value={stage.price} disabled={!canPublish} onChange={(e) => updateStage(si, { price: Number(e.target.value) })} placeholder="Цена, ₽" style={{ ...inputStyle, flex: '0 1 140px' }} />
            {canPublish && <button onClick={() => setDraft((d) => d.filter((_, j) => j !== si))} style={outlineBtn}>Удалить этап</button>}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <textarea
              value={stage.offerText ?? ''} disabled={!canPublish}
              onChange={(e) => updateStage(si, { offerText: e.target.value })}
              placeholder="Условия оффера этапа (необязательно) — если заполнено, клиника должна принять их до заказа оплаты"
              style={{ ...inputStyle, flex: '1 1 260px', minHeight: 44, fontFamily: 'inherit' }}
            />
            <input
              value={stage.offerFile ?? ''} disabled={!canPublish}
              onChange={(e) => updateStage(si, { offerFile: e.target.value })}
              placeholder="Имя файла оффера (например Оффер_этап_1.pdf)"
              style={{ ...inputStyle, flex: '1 1 220px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 12, borderLeft: '2px solid var(--border-2)' }}>
            {stage.blocks.map((block, bi) => (
              <div key={bi} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input value={block.num} disabled={!canPublish} onChange={(e) => updateBlock(si, bi, { num: e.target.value })} placeholder="№" style={{ ...inputStyle, flex: '0 1 60px' }} />
                  <input value={block.name} disabled={!canPublish} onChange={(e) => updateBlock(si, bi, { name: e.target.value })} placeholder="Название блока" style={{ ...inputStyle, flex: '1 1 220px' }} />
                  {canPublish && (
                    <button onClick={() => updateStage(si, { blocks: stage.blocks.filter((_, k) => k !== bi) })} style={outlineBtn}>Удалить блок</button>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12, borderLeft: '2px solid var(--border-3)' }}>
                  {block.docs.map((doc, di) => (
                    <div key={di} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <input value={doc.name} disabled={!canPublish} onChange={(e) => updateDoc(si, bi, di, { name: e.target.value })} placeholder="Название документа" style={{ ...inputStyle, flex: '1 1 220px' }} />
                      <textarea value={doc.template} disabled={!canPublish} onChange={(e) => updateDoc(si, bi, di, { template: e.target.value })} placeholder="Текст шаблона" style={{ ...inputStyle, flex: '2 1 260px', minHeight: 44, fontFamily: 'inherit' }} />
                      {canPublish && (
                        <button onClick={() => updateBlock(si, bi, { docs: block.docs.filter((_, m) => m !== di) })} style={outlineBtn} aria-label="Удалить документ">✕</button>
                      )}
                    </div>
                  ))}
                  {canPublish && (
                    <button onClick={() => updateBlock(si, bi, { docs: block.docs.concat([{ name: '', template: '' }]) })} style={dashedBtn}>+ документ</button>
                  )}
                </div>
              </div>
            ))}
            {canPublish && (
              <button onClick={() => updateStage(si, { blocks: stage.blocks.concat([{ key: `b${stage.blocks.length + 1}`, num: String(stage.blocks.length + 1).padStart(2, '0'), name: '', docs: [] }]) })} style={dashedBtn}>
                + блок документов
              </button>
            )}
          </div>
        </div>
      ))}
      {canPublish && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setDraft((d) => d.concat([{ code: d.length ? Math.max(...d.map((s) => s.code)) + 1 : 1, name: 'Новый этап', price: 0, blocks: [] }]))} style={outlineBtn}>
            + этап
          </button>
          <button onClick={() => onPublish(draft)} style={primaryBtn}>Опубликовать каталог этапов</button>
        </div>
      )}
    </div>
  );
}

// --- Годовой цикл (cycle_master) ---

export interface CycleDirectionDraft {
  name: string;
  months: number[];
}
export interface CapaTermDraft {
  level: string;
  days: number;
}
export interface CycleMasterDraft {
  year: number;
  dirs: CycleDirectionDraft[];
  capaTerms: CapaTermDraft[];
}

const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function CycleMasterForm({ cycle, canPublish, onPublish }: { cycle: CycleMasterDraft | null; canPublish: boolean; onPublish: (next: CycleMasterDraft) => void }) {
  const [draft, setDraft] = useState<CycleMasterDraft>(cycle ?? { year: new Date().getFullYear(), dirs: [], capaTerms: [] });
  useEffect(() => setDraft(cycle ?? { year: new Date().getFullYear(), dirs: [], capaTerms: [] }), [cycle]);

  function updateDir(i: number, patch: Partial<CycleDirectionDraft>) {
    setDraft((d) => ({ ...d, dirs: d.dirs.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  }
  function toggleMonth(i: number, m: number) {
    const dir = draft.dirs[i];
    if (!dir) return;
    const months = dir.months.includes(m) ? dir.months.filter((x) => x !== m) : dir.months.concat([m]).sort((a, b) => a - b);
    updateDir(i, { months });
  }
  function updateTerm(i: number, patch: Partial<CapaTermDraft>) {
    setDraft((d) => ({ ...d, capaTerms: d.capaTerms.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Год</div>
        <input type="number" value={draft.year} disabled={!canPublish} onChange={(e) => setDraft((d) => ({ ...d, year: Number(e.target.value) }))} style={{ ...inputStyle, maxWidth: 140 }} />
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Направления и месяцы проверок</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {draft.dirs.map((dir, i) => (
            <div key={i} style={{ border: '1px solid var(--border-2)', borderRadius: 9, padding: '10px 12px' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={dir.name} disabled={!canPublish} onChange={(e) => updateDir(i, { name: e.target.value })} placeholder="Название направления" style={{ ...inputStyle, flex: '1 1 auto' }} />
                {canPublish && <button onClick={() => setDraft((d) => ({ ...d, dirs: d.dirs.filter((_, j) => j !== i) }))} style={outlineBtn}>Удалить</button>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {MONTH_NAMES.map((label, m) => (
                  <button
                    key={m}
                    disabled={!canPublish}
                    onClick={() => toggleMonth(i, m)}
                    style={{
                      padding: '5px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                      border: `1px solid ${dir.months.includes(m) ? 'var(--accent)' : 'var(--border-1)'}`,
                      background: dir.months.includes(m) ? 'var(--accent)' : '#fff', color: dir.months.includes(m) ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {canPublish && (
            <button onClick={() => setDraft((d) => ({ ...d, dirs: d.dirs.concat([{ name: '', months: [] }]) }))} style={dashedBtn}>+ направление</button>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>Сроки устранения по степени несоответствия (CAPA)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {draft.capaTerms.map((term, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={term.level} disabled={!canPublish} onChange={(e) => updateTerm(i, { level: e.target.value })} placeholder="Степень (например «критическое»)" style={{ ...inputStyle, flex: '1 1 220px' }} />
              <input type="number" value={term.days} disabled={!canPublish} onChange={(e) => updateTerm(i, { days: Number(e.target.value) })} placeholder="Срок, дней" style={{ ...inputStyle, flex: '0 1 140px' }} />
              {canPublish && <button onClick={() => setDraft((d) => ({ ...d, capaTerms: d.capaTerms.filter((_, j) => j !== i) }))} style={outlineBtn} aria-label="Удалить срок">✕</button>}
            </div>
          ))}
          {canPublish && (
            <button onClick={() => setDraft((d) => ({ ...d, capaTerms: d.capaTerms.concat([{ level: '', days: 10 }]) }))} style={dashedBtn}>+ срок</button>
          )}
        </div>
      </div>

      {canPublish && <button onClick={() => onPublish(draft)} style={{ ...primaryBtn, alignSelf: 'flex-start' }}>Опубликовать годовой цикл</button>}
    </div>
  );
}

// --- Типы оборудования (equip_types) ---

export interface EquipLogDraft {
  name: string;
  freq: string;
  kind: 'журнал' | 'чек-лист';
}
export interface EquipTypeDraft {
  key: string;
  name: string;
  logs: EquipLogDraft[];
}

export function EquipTypesForm({ types, canPublish, onPublish }: { types: EquipTypeDraft[]; canPublish: boolean; onPublish: (next: EquipTypeDraft[]) => void }) {
  const [draft, setDraft] = useState<EquipTypeDraft[]>(types);
  useEffect(() => setDraft(types), [types]);

  function updateType(i: number, patch: Partial<EquipTypeDraft>) {
    setDraft((d) => d.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function updateLog(ti: number, li: number, patch: Partial<EquipLogDraft>) {
    setDraft((d) => d.map((t, j) => (j !== ti ? t : { ...t, logs: t.logs.map((l, k) => (k === li ? { ...l, ...patch } : l)) })));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {draft.map((type, ti) => (
        <div key={ti} style={cardStyle}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={type.key} disabled={!canPublish} onChange={(e) => updateType(ti, { key: e.target.value })} placeholder="Ключ (латиницей)" style={{ ...inputStyle, flex: '0 1 160px', fontFamily: 'var(--font-mono)' }} />
            <input value={type.name} disabled={!canPublish} onChange={(e) => updateType(ti, { name: e.target.value })} placeholder="Название типа" style={{ ...inputStyle, flex: '1 1 220px' }} />
            {canPublish && <button onClick={() => setDraft((d) => d.filter((_, j) => j !== ti))} style={outlineBtn}>Удалить тип</button>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12, borderLeft: '2px solid var(--border-2)' }}>
            {type.logs.map((log, li) => (
              <div key={li} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={log.name} disabled={!canPublish} onChange={(e) => updateLog(ti, li, { name: e.target.value })} placeholder="Название формы" style={{ ...inputStyle, flex: '1 1 200px' }} />
                <input value={log.freq} disabled={!canPublish} onChange={(e) => updateLog(ti, li, { freq: e.target.value })} placeholder="Периодичность" style={{ ...inputStyle, flex: '1 1 160px' }} />
                <select value={log.kind} disabled={!canPublish} onChange={(e) => updateLog(ti, li, { kind: e.target.value as EquipLogDraft['kind'] })} style={{ ...inputStyle, flex: '0 1 140px' }}>
                  <option value="журнал">журнал</option>
                  <option value="чек-лист">чек-лист</option>
                </select>
                {canPublish && <button onClick={() => updateType(ti, { logs: type.logs.filter((_, k) => k !== li) })} style={outlineBtn} aria-label="Удалить форму">✕</button>}
              </div>
            ))}
            {canPublish && (
              <button onClick={() => updateType(ti, { logs: type.logs.concat([{ name: '', freq: 'ежедневно', kind: 'журнал' }]) })} style={dashedBtn}>+ форма</button>
            )}
          </div>
        </div>
      ))}
      {canPublish && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setDraft((d) => d.concat([{ key: '', name: '', logs: [] }]))} style={outlineBtn}>+ тип оборудования</button>
          <button onClick={() => onPublish(draft)} style={primaryBtn}>Опубликовать типы оборудования</button>
        </div>
      )}
    </div>
  );
}

// --- Сводный отчёт (summary_master) ---

export interface SummaryRowDraft {
  name: string;
  note: string;
  req: boolean;
}

export function SummaryMasterForm({ rows, canPublish, onPublish }: { rows: SummaryRowDraft[]; canPublish: boolean; onPublish: (next: SummaryRowDraft[]) => void }) {
  const [draft, setDraft] = useState<SummaryRowDraft[]>(rows);
  useEffect(() => setDraft(rows), [rows]);

  function updateRow(i: number, patch: Partial<SummaryRowDraft>) {
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {draft.map((row, i) => (
        <div key={i} style={cardStyle}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={row.name} disabled={!canPublish} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="Название документа отчёта" style={{ ...inputStyle, flex: '1 1 260px' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={row.req} disabled={!canPublish} onChange={(e) => updateRow(i, { req: e.target.checked })} />
              обязательный
            </label>
            {canPublish && <button onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} style={outlineBtn}>Удалить</button>}
          </div>
          <input value={row.note} disabled={!canPublish} onChange={(e) => updateRow(i, { note: e.target.value })} placeholder="Примечание" style={{ ...inputStyle, marginTop: 8 }} />
        </div>
      ))}
      {canPublish && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setDraft((d) => d.concat([{ name: '', note: '', req: true }]))} style={outlineBtn}>+ строка</button>
          <button onClick={() => onPublish(draft)} style={primaryBtn}>Опубликовать состав отчёта</button>
        </div>
      )}
    </div>
  );
}
