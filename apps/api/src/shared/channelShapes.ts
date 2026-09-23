/**
 * Формы каналов данных, общие для нескольких перенесённых экранов (исполнитель,
 * обход). Полная форма описана в `reference/prototype/Личный кабинет ВКК.dc.html`
 * и `reference/prototype/Обход - мобильный.dc.html` — публикуют эти каналы кабинет
 * клиники и панель, которые ещё не перенесены; здесь — срез полей, которые
 * фактически читают/пишут уже перенесённые экраны.
 */

export interface ClientStateShape {
  asgMap?: Record<string, string>; // ключ "этап|блок|номер|документ" -> "ФИО (+ ФИО …)"
  staffByBranch?: Record<string, { fio: string; pos: string }[]>;
}

/**
 * Строка плана проверок клиники (`k785_audit_plan_<ИНН>`). `name` — заголовок,
 * который показывает простой обзор (кабинет исполнителя); `check`/`dir` —
 * привязка к чек-листу методиста, которую разбирает мобильный обход
 * (reference/prototype/Обход - мобильный.dc.html) — это разные поля одной строки,
 * не альтернативные названия одного и того же.
 */
export interface AuditPlanItem {
  id: string;
  name?: string;
  dir?: string; // направление/название проверки — то, что показывает ссылку на проверку, если check не задан
  check?: string; // имя чек-листа из каталога методиста — сверяется через normalizeChecklistName
  object?: string;
  branch?: string;
  kind?: 'плановая' | 'внеплановая' | 'целевая';
  date?: string;
  due?: string;
  reason?: string;
  who?: string; // назначенный проверяющий(е), формат "ФИО (+ ФИО · филиал)"
  docs?: (string | [string, string])[];
}

/** Один пункт чек-листа внутри результата обхода (`k785_walk_results_<ИНН>[planId].items[]`). */
export interface WalkResultItem {
  text: string;
  answer: '' | 'ok' | 'bad';
  comment: string;
  photoFileId: string | null;
}

/** Результат обхода по одной проверке плана (SERVER.md §3: `k785_walk_results_ИНН`). */
export interface WalkResultEntry {
  planId: string;
  walkId: string;
  name: string;
  object: string;
  kind: string;
  who: string;
  finished: boolean;
  answered: number;
  total: number;
  bad: number;
  date: string;
  source: 'мобильный обход';
  items: WalkResultItem[];
}

/** Каталог чек-листов методиста (`k785_checklists`, платформенный канал). */
export interface ChecklistDef {
  name: string;
  items: string[];
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

/**
 * Корректирующее мероприятие — заводится по конкретному нарушению аудита
 * (`planCapaFor` в reference/prototype/Личный кабинет ВКК.dc.html, строки
 * ~3771–3793). Хранится в тенантском канале `capa`, ключ записи — id.
 * Упрощение относительно прототипа: без цепочки повторных проверок
 * (`root`/`round`/`rechecks`) — это отдельная фича годового цикла, который
 * ещё не перенесён (см. README «Известные ограничения»).
 */
export interface CapaItem {
  id: string;
  sourcePlanId: string | null;
  sourceItemIndex: number | null;
  auditName: string;
  object: string;
  findingText: string;
  comment: string;
  who: string; // ответственный за устранение
  due: string; // ДД.ММ.ГГГГ, может быть пустым — задаётся позже
  status: 'planned' | 'done';
  createdAt: string;
  createdBy: string;
  closedAt: string | null;
}

/**
 * Документ внутри блока этапа. `template` — текст с плейсхолдерами
 * `{{org}}`, `{{inn}}`, `{{date}}`, `{{responsible}}` (последний берётся из
 * матрицы ответственных, `docasg[name]`) — перенос идеи «бланк выбирается по
 * виду документа, в переменные подставляются реквизиты профиля и
 * ответственный по направлению» из README, без полноценного профиля клиники
 * (адрес, лицензия и т.д. — этого поля ещё нет, см. README «Известные
 * ограничения»).
 */
export interface StageDoc {
  name: string;
  template: string;
}

/**
 * Блок документов внутри этапа — реальные названия и состав перенесены из
 * `reference/prototype/Личный кабинет ВКК.dc.html` (каталог `b01`…`b09`,
 * строки ~6585–6593), а не выдуманы заново.
 */
export interface StageBlock {
  key: string;
  num: string;
  name: string;
  docs: StageDoc[];
}

/**
 * Этап внедрения. Цены — из прототипа (offer-карточки этапов, строки
 * ~7346–7349): 68 000 / 68 000 / 54 000 / 42 000 ₽.
 */
export interface Stage {
  code: number;
  name: string;
  price: number;
  blocks: StageBlock[];
}

export type StagePaymentStatus = 'none' | 'pending' | 'paid';

/** Строка канала `stage_paid` — одна на этап (SERVER.md §3, §5). */
export interface StagePaymentState {
  status: StagePaymentStatus;
  requestedAt: string | null;
  requestedBy: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  amount: number;
}

/**
 * Годовой цикл — эталон методиста (`cycle_master`, платформенный канал).
 * Публикуется методистом, разбор в помесячный план проверок клиники
 * (`cycle_live`) не перенесён (README «Что дальше») — здесь только
 * публикация самого эталона: направление, месяцы проверок, срок CAPA.
 */
export interface CycleDirection {
  name: string;
  months: number[]; // 0–11, в какие месяцы проводится проверка направления
}

export interface CapaTerm {
  level: string; // например "критическое несоответствие"
  days: number; // срок устранения в днях
}

export interface CycleMaster {
  year: number;
  dirs: CycleDirection[];
  capaTerms: CapaTerm[];
}
