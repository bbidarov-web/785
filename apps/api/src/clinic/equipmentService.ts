import { randomUUID } from 'node:crypto';
import { can } from '@kontur785/shared';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission, PermissionDeniedError } from '../rbac/service.js';
import { assignees, isMine } from '../shared/assignment.js';
import type { EquipmentFill, EquipmentPosition, EquipmentType } from '../shared/channelShapes.js';

export type EquipmentResult<T> = { ok: true } & T | { ok: false; error: string };

export interface EquipmentFormView {
  posUid: string;
  posName: string;
  room: string;
  formName: string;
  freq: string;
  kind: 'журнал' | 'чек-лист';
  who: string;
  dueNow: boolean;
  lastFill: EquipmentFill | null;
}

/** Периодичность формы → сколько дней считается «пора заполнять снова» (перенос `formDue` из reference/prototype/Обход - мобильный.dc.html). */
const FREQ_DAYS: Record<string, number> = {
  'каждое включение': 1, 'каждый цикл': 1, '2 раза в день': 1, ежедневно: 1,
  '1 раз в неделю': 7, '1 раз в месяц': 30, '1 раз в квартал': 92,
  '1 раз в полгода': 183, '1 раз в год': 365,
};

function daysSince(dateStr: string, now: Date): number {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(dateStr);
  if (!m) return Infinity;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (isNaN(d.getTime())) return Infinity;
  return Math.round((now.getTime() - d.getTime()) / 86400000);
}

function isDue(freq: string, lastDate: string | undefined, now: Date): boolean {
  if (!lastDate) return true; // без даты форма считается требующей заполнения — ложное «заполнено» опаснее лишнего напоминания
  const days = FREQ_DAYS[freq.trim()] ?? 30;
  return daysSince(lastDate, now) >= days;
}

function today(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()}`;
}

/**
 * Оборудование и журналы (README «Кабинет клиники», «Кабинет исполнителя»,
 * «Мобильный обход»). Клиника ведёт реестр позиций (`doc:write`), заполняет
 * формы клиника или обход (`journal:write` — клиника ведёт документально по
 * `reference/prototype/Обход - мобильный.dc.html`, строка ~848: «журналы по
 * оборудованию ведут исполнитель, ответственный за ВКК и админ клиники»;
 * аудитор ведёт проверки, но не журналы — тем же правом это уже разделено).
 */
export class EquipmentService {
  constructor(private repos: Repos) {}

  async listPositions(account: Account): Promise<EquipmentPosition[]> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'equipment:list', null, account.inn);
    return (await this.repos.channels.get<EquipmentPosition[]>('tenant', account.inn, 'equip_pos', [])).data;
  }

  async getTypes(): Promise<EquipmentType[]> {
    return (await this.repos.channels.get<EquipmentType[]>('platform', null, 'equip_types', [])).data;
  }

  async upsertPosition(account: Account, pos: Omit<EquipmentPosition, 'uid'> & { uid?: string }): Promise<EquipmentResult<{ position: EquipmentPosition }>> {
    await assertPermission(this.repos.auditLog, account, 'doc:write', 'equipment:upsert', pos.name, account.inn);
    const saved: EquipmentPosition = { ...pos, uid: pos.uid || randomUUID() };
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<EquipmentPosition[]>('tenant', account.inn, 'equip_pos', []);
      const next = rec.data.filter((p) => p.uid !== saved.uid).concat([saved]);
      const res = await this.repos.channels.set('tenant', account.inn, 'equip_pos', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, position: saved };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async removePosition(account: Account, uid: string): Promise<EquipmentResult<Record<string, unknown>>> {
    await assertPermission(this.repos.auditLog, account, 'doc:write', 'equipment:remove', uid, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<EquipmentPosition[]>('tenant', account.inn, 'equip_pos', []);
      if (!rec.data.some((p) => p.uid === uid)) return { ok: false, error: 'Позиция не найдена' };
      const next = rec.data.filter((p) => p.uid !== uid);
      const res = await this.repos.channels.set('tenant', account.inn, 'equip_pos', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  /** clinic_admin/vkk_lead видят все формы (doc:write), остальные — только назначенные им лично. */
  async listForms(account: Account): Promise<EquipmentFormView[]> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'equipment:forms', null, account.inn);
    const canSeeAll = can(account.role, 'doc:write');
    const [positions, types, fills] = await Promise.all([
      this.repos.channels.get<EquipmentPosition[]>('tenant', account.inn, 'equip_pos', []),
      this.getTypes(),
      this.repos.channels.get<Record<string, EquipmentFill>>('tenant', account.inn, 'equip_fill', {}),
    ]);
    const typeByKey = new Map(types.map((t) => [t.key, t]));
    const now = this.repos.clock.now();
    const out: EquipmentFormView[] = [];
    for (const p of positions.data) {
      const type = typeByKey.get(p.type ?? '');
      for (const log of type?.logs ?? []) {
        const who = (p.logWho ?? {})[log.name] ?? '';
        if (!canSeeAll && !isMine(who, account.fio)) continue;
        const fill = fills.data[`${p.uid}|${log.name}`] ?? null;
        out.push({
          posUid: p.uid, posName: p.name, room: p.room ?? '', formName: log.name, freq: log.freq, kind: log.kind,
          who: assignees(who).join(' + ') || 'не назначен',
          dueNow: isDue(log.freq, fill?.date, now),
          lastFill: fill,
        });
      }
    }
    return out;
  }

  async fillForm(
    account: Account,
    posUid: string,
    formName: string,
    input: { value?: string; note?: string; answers?: Record<string, 'ok' | 'bad'> },
    source: 'обход' | 'кабинет клиники',
  ): Promise<EquipmentResult<{ fill: EquipmentFill }>> {
    await assertPermission(this.repos.auditLog, account, 'journal:write', 'equipment:fill', `${posUid}|${formName}`, account.inn);
    const positions = (await this.repos.channels.get<EquipmentPosition[]>('tenant', account.inn, 'equip_pos', [])).data;
    const pos = positions.find((p) => p.uid === posUid);
    if (!pos) return { ok: false, error: 'Позиция оборудования не найдена' };

    const canSeeAll = can(account.role, 'doc:write');
    if (!canSeeAll) {
      const who = (pos.logWho ?? {})[formName] ?? '';
      if (!isMine(who, account.fio)) throw new PermissionDeniedError('equipment:not-assigned');
    }

    const fill: EquipmentFill = { date: today(this.repos.clock.now()), who: account.fio, value: input.value ?? '', note: input.note ?? '', answers: input.answers ?? {}, source };
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, EquipmentFill>>('tenant', account.inn, 'equip_fill', {});
      const next = { ...rec.data, [`${posUid}|${formName}`]: fill };
      const res = await this.repos.channels.set('tenant', account.inn, 'equip_fill', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, fill };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }
}
