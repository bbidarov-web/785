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
  branch?: string;
  type?: string; // ключ типа из каталога методиста (`equip_types`)
  logWho?: Record<string, string>; // форма журнала -> "ФИО (+ ФИО …)"
}

/** Заполнение одной формы одной позиции оборудования (ключ канала — `<uid>|<форма>`). */
export interface EquipmentFill {
  date?: string;
  who?: string;
  value?: string;
  note?: string;
  answers?: Record<string, 'ok' | 'bad'>; // для форм вида "чек-лист" — ключ - индекс пункта строкой (JSON-границы: числовые ключи всё равно строки)
  source?: 'обход' | 'кабинет клиники';
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
  sourceKind: 'walk' | 'selfaudit';
  sourcePlanId: string | null; // walk: id проверки плана; selfaudit: имя чек-листа
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

/**
 * Строка канала `stage_paid` — одна на этап (SERVER.md §3, §5). `accepted` —
 * отдельная от оплаты «приёмка» этапа платформой (методист/администратор,
 * право `doc:grant`): по офферам прототипа «Оплата по факту приёмки этапа»
 * (reference/README.md, строки ~7346–7349) — этапы идут строго по порядку,
 * заказать оплату следующего можно только когда предыдущий и оплачен, и
 * принят платформой. Оплата и приёмка — разные факты и разные роли: продавец
 * подтверждает деньги, методист/администратор — что работа по этапу сделана.
 */
export interface StagePaymentState {
  status: StagePaymentStatus;
  requestedAt: string | null;
  requestedBy: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  amount: number;
  accepted: boolean;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

/** Годовой цикл — эталон методиста (`cycle_master`, платформенный канал). */
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

/**
 * Разбор эталона клиникой (`cycle_live`, тенантский канал) — направление
 * может переопределить месяцы эталона и добавить то, чего в эталоне нет:
 * привязанный чек-лист, объект, филиал, ответственного. Направление, не
 * упомянутое здесь, берёт месяцы прямо из `cycle_master` как есть.
 */
export interface CycleLiveDirection {
  name: string;
  months?: number[]; // не задано — берутся месяцы эталона
  check?: string;
  object?: string;
  branch?: string;
  who?: string;
}

export interface CycleLive {
  year: number;
  dirs: CycleLiveDirection[];
}

/** Объект клиники — филиал или головное подразделение (README «Профиль клиники»). */
export interface Branch {
  id: string;
  name: string;
}

/** Тип оборудования из эталона методиста (`equip_types`, платформенный канал). */
export interface EquipmentLogDef {
  name: string;
  freq: string; // например "ежедневно", "1 раз в месяц" — формат normalizeChecklistName не участвует, сверяется дословно
  kind: 'журнал' | 'чек-лист';
}

export interface EquipmentType {
  key: string;
  name: string;
  logs: EquipmentLogDef[];
}

/** Строка сводного отчёта из эталона методиста (`summary_master`, платформенный канал). */
export interface SummaryRowDef {
  name: string;
  note: string;
  req: boolean; // обязательный документ или "по желанию"
}

/** Файл клиники, загруженный по строке сводного отчёта (`summary_files`, тенантский канал). */
export interface SummaryFileEntry {
  fileId: string;
  fileName: string;
  date: string;
  uploadedBy: string;
}

/**
 * Тариф из каталога продаж (`tariffs`, платформенный канал; README «Дашборд»
 * упоминает «востребованность тарифов»). Черновик (`active:false`) правит кто
 * угодно с `tariff:write` напрямую; включение в продажу и удаление — операции
 * второй руки (`tariff:publish`/`tariff:delete`, SERVER.md §4) — их подтверждает
 * ВТОРОЙ сотрудник с `second:money` (руководитель продаж/администратор), не
 * автор запроса.
 */
export interface TariffDef {
  key: string;
  name: string;
  price: number;
  period: 'monthly' | 'annual';
  description: string;
  active: boolean;
}

export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'expired' | 'cancelled';

export interface SubscriptionEvent {
  at: string; // ДД.ММ.ГГГГ
  byId: string;
  action: 'assign' | 'renew' | 'cancel';
  tariffKey: string | null;
}

/**
 * Подписка клиники (`subscription`, тенантский канал). Назначает и продлевает
 * менеджер/руководитель продаж/администратор (`sub:write`) — прямое действие,
 * не входит в семь операций второй руки.
 */
export interface SubscriptionState {
  tariffKey: string | null;
  status: SubscriptionStatus;
  startedAt: string | null;
  expiresAt: string | null;
  history: SubscriptionEvent[];
}

/**
 * Состояние одной задачи очереди работы (`work_queue_state`, платформенный
 * канал; reference/prototype/Админ-панель.dc.html «Очередь работы»). Сама
 * задача НЕ хранится — она пересчитывается из реальных данных при каждом
 * чтении (`WorkQueueService.list`), здесь только состояние работы над ней:
 * «взял в работу / отложил / закрыл» — общее для всех сотрудников платформы,
 * чтобы одну клинику не обзвонили дважды. Отложенная возвращается в очередь
 * через 3 дня; закрытая — на следующий день, если причина не исчезла.
 */
export type QueueTaskWorkState = 'in_progress' | 'postponed' | 'closed';

export interface QueueTaskState {
  state: QueueTaskWorkState;
  byId: string;
  at: string; // ДД.ММ.ГГГГ
  postponedUntil: string | null; // только для state='postponed'
}

/** Настройки ежедневной сводки очереди работы (`queue_digest_settings`, платформенный канал). */
export interface QueueDigestSettings {
  recipientEmail: string;
  schedule: string; // например "каждое утро, 09:00" — расписание хранится как факт, автоматическая отправка по расписанию не подключена (см. README «Что дальше»)
  lastSentAt: string | null;
}

export type SelfAuditAnswer = '' | 'ok' | 'bad' | 'na'; // соответствует / не соответствует / не применимо

export interface SelfAuditItem {
  text: string;
  answer: SelfAuditAnswer;
  comment: string;
}

/** Один прогон самообследования по одному чек-листу (`selfaudit`, тенантский канал). */
export interface SelfAuditRun {
  checklistName: string;
  items: SelfAuditItem[];
  finished: boolean;
  date: string;
}
