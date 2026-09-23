/**
 * Формы каналов, которые читает кабинет исполнителя. Источник — рабочее состояние
 * клиники (`client_state`) и матрица назначений (`docasg`), которые публикует
 * кабинет клиники/панель — полная форма описана в `reference/prototype/Личный
 * кабинет ВКК.dc.html` и переносится по мере порта этого экрана. Здесь — только
 * срез полей, которые фактически читает `Кабинет исполнителя.dc.html`.
 */

export interface ClientStateShape {
  asgMap?: Record<string, string>; // ключ "этап|блок|номер|документ" -> "ФИО (+ ФИО …)"
  staffByBranch?: Record<string, { fio: string; pos: string }[]>;
}

export interface AuditPlanItem {
  name?: string;
  object?: string;
  kind?: string;
  date?: string;
  who?: string;
}

export interface WalkResult {
  finished?: boolean;
  name?: string;
}

export interface EquipmentPosition {
  uid: string;
  name: string;
  room?: string;
  logWho?: Record<string, string>; // форма журнала -> "ФИО (+ ФИО …)"
}

export interface EquipmentFill {
  date?: string;
  who?: string;
}

export interface StaffMember {
  fio: string;
  pos: string;
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
