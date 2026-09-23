export type { ClientStateShape, StaffMember } from '../shared/channelShapes.js';
import type { AuditPlanItem as SharedAuditPlanItem, WalkResultEntry } from '../shared/channelShapes.js';

/** Кабинет исполнителя читает план проверок по простым полям — остальные нужны только обходу. */
export type AuditPlanItem = Pick<SharedAuditPlanItem, 'id' | 'name' | 'object' | 'kind' | 'date' | 'who'>;

/** Кабинету исполнителя из результата обхода важно только, завершена ли проверка. */
export type WalkResult = Pick<WalkResultEntry, 'finished' | 'name'>;

export interface EquipmentPosition {
  uid: string;
  name: string;
  room?: string;
  logWho?: Record<string, string>;
}

export interface EquipmentFill {
  date?: string;
  who?: string;
}

export interface ExecutorDoc {
  code: string;
  name: string;
  where: string;
  done: boolean;
  doneAt: string | null;
  together: string[];
}

export interface ExecutorCheck {
  name: string;
  where: string;
  done: boolean;
  date: string | null;
}

export interface ExecutorLog {
  form: string;
  positionName: string;
  hasEntries: boolean;
  lastDate: string | null;
  lastBy: string | null;
}

export interface ExecutorOverview {
  fio: string;
  position: string;
  clinicName: string;
  inn: string;
  docs: ExecutorDoc[];
  checks: ExecutorCheck[];
  logs: ExecutorLog[];
}
