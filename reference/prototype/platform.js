// Слой доступа к данным продукта.
// Заменяет приём прототипа — прямой localStorage и опрос по таймеру — на контракт,
// который переносится на сервер без изменения вызывающего кода:
//   • изоляция арендатора: клиент не может прочитать или записать чужое пространство
//   • транзакции: запись с проверкой версии, конфликт возвращается вызывающему
//   • события: подписка вместо опроса
//   • идемпотентность: повтор операции с тем же opId не создаёт дубль
//   • роли: право проверяется до записи, отказ фиксируется

const CHANNEL = 'k785-events';
const META = 'k785__meta';

// Пространство стандарта: издания методиста, общие для всех арендаторов
const PLATFORM_KEYS = [
  'k785_stage_docs', 'k785_checklists', 'k785_blocks_catalog', 'k785_doc_catalogs',
  'k785_block_tpls', 'k785_block_pins', 'k785_required', 'k785_positions',
  'k785_licworks', 'k785_doc_revs', 'k785_cycle_master', 'k785_sheets'
];

// k785_admin_state — рабочее состояние оператора, а не изданный стандарт: пишется любой ролью

// Сторона платформы разделена на три роли: методист ведёт эталоны и аудиты,
// менеджер — деньги и продажи, администратор — всё плюс роли. Менеджер не публикует
// чек-листы во все кабинеты, методист не подтверждает оплату — разделение полномочий
export const ROLES = {
  methodist: {
    name: 'Методист платформы',
    short: 'методист',
    perms: ['standard:read', 'standard:write', 'standard:publish', 'revision:write', 'clinic:read', 'journal:read',
      'audit:manage', 'message:send', 'money:read', 'bulk:methodology', 'second:standard', 'doc:grant']
  },
  sales_manager: {
    name: 'Менеджер по продажам',
    short: 'менеджер',
    perms: ['standard:read', 'clinic:read', 'journal:read',
      'money:read', 'money:write', 'tariff:write', 'sub:write', 'message:send', 'bulk:money', 'doc:grant']
  },
  sales_head: {
    // при 2–5 менеджерах подтверждать денежные операции должен их руководитель,
    // иначе второй рукой каждый раз выступает владелец продукта
    name: 'Руководитель продаж',
    short: 'руководитель продаж',
    perms: ['standard:read', 'clinic:read', 'journal:read',
      'money:read', 'money:write', 'tariff:write', 'sub:write', 'message:send', 'bulk:money', 'second:money', 'doc:grant']
  },
  platform_admin: {
    name: 'Администратор платформы',
    short: 'администратор',
    perms: ['standard:read', 'standard:write', 'standard:publish', 'revision:write', 'clinic:read', 'journal:read',
      'audit:manage', 'message:send', 'money:read', 'money:write', 'tariff:write', 'sub:write',
      'bulk:methodology', 'bulk:money', 'role:manage', 'second:money', 'second:standard', 'doc:grant']
  },
  clinic_admin: {
    name: 'Администратор клиники',
    short: 'админ клиники',
    perms: ['standard:read', 'org:write', 'adoption:decide', 'doc:read', 'doc:write', 'tariff:read', 'order:write',
      'journal:read', 'journal:write', 'plan:read', 'plan:write', 'capa:write', 'staff:manage']
  },
  vkk_lead: {
    name: 'Ответственный за ВКК',
    short: 'ответственный за ВКК',
    perms: ['standard:read', 'adoption:decide', 'doc:read', 'doc:write', 'plan:read', 'plan:write', 'walk:run',
      'capa:write', 'journal:read', 'journal:write']
  },
  // медсестра ведёт записи и формы по оборудованию, но не правит состав документов
  // и не видит денег: именно её руками система ведётся ежедневно
  nurse: {
    name: 'Медсестра / исполнитель',
    short: 'исполнитель',
    perms: ['doc:read', 'plan:read', 'journal:read', 'journal:write', 'walk:run', 'capa:own']
  },
  auditor: {
    name: 'Аудитор',
    short: 'аудитор',
    perms: ['doc:read', 'plan:read', 'walk:run', 'capa:own', 'journal:read']
  },
  observer: {
    name: 'Наблюдатель',
    short: 'наблюдатель',
    perms: ['doc:read', 'plan:read', 'journal:read']
  }
};

export const PLATFORM_TENANT = '__platform__';

// глобальные ключи без арендатора: рабочее состояние экранов и межэкранные сигналы
// k785_branch_alert переведён на ключ арендатора (k785_branch_alert_<ИНН>); имя
// оставлено в списке только для чтения оставшихся старых записей
const GLOBAL_KEYS = ['k785_admin_state', 'k785_client_state', 'k785_branch_alert', 'k785__meta'];

// Арендатор определяется явным суффиксом ключа, а не разбором имени:
// разбор ленивым шаблоном захватывал часть префикса и отбраковывал свои же ключи.
function scopeOf(key, tenant) {
  const k = String(key);
  if (PLATFORM_KEYS.indexOf(k) >= 0) return { scope: 'platform', tenant: PLATFORM_TENANT };
  if (GLOBAL_KEYS.indexOf(k) >= 0) return { scope: 'global', tenant: null };
  if (tenant && k.slice(-(String(tenant).length + 1)) === '_' + tenant) {
    return { scope: 'tenant', tenant: tenant };
  }
  const m = k.match(/^k785_[a-z_]+_(.+)$/);
  if (m) return { scope: 'tenant', tenant: m[1] };
  return { scope: 'global', tenant: null };
}

function readRaw(key) {
  try { return window.localStorage.getItem(key); } catch (err) { return null; }
}

function writeRaw(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch (err) { return false; }
}

function meta() {
  try { return JSON.parse(readRaw(META) || '{}') || {}; } catch (err) { return {}; }
}

function setMeta(next) {
  writeRaw(META, JSON.stringify(next));
}

let channel = null;
const listeners = [];

function ensureChannel() {
  if (channel !== null) return;
  try {
    channel = new window.BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => emit(e.data || {});
  } catch (err) {
    channel = false;
  }
  // события от других вкладок; собственные изменения приходят через канал.
  // писателя берём из журнала версий: без него две копии одной страницы
  // отвечали друг другу на собственные записи и держали основной поток
  window.addEventListener('storage', (e) => {
    if (!e || !e.key || String(e.key).indexOf('k785') !== 0) return;
    if (String(e.key) === META) return;
    let writer = null;
    try { writer = (meta()[e.key] || {}).writer || null; } catch (err) { writer = null; }
    emit({ key: e.key, at: Date.now(), origin: 'storage', writer });
  });
}

function emit(evt) {
  listeners.forEach((l) => {
    // свою же запись не возвращаем подписчику: иначе он перерисовывается на собственном сохранении
    if (l.skipSelf && evt.writer && l.owner === evt.writer) return;
    if (!l.keys || l.keys.some((k) => k === evt.key || (k.slice(-1) === '*' && String(evt.key).indexOf(k.slice(0, -1)) === 0))) {
      try { l.cb(evt); } catch (err) { /* подписчик не должен ломать рассылку */ }
    }
  });
}

function publish(key, writer) {
  const evt = { key, at: Date.now(), origin: 'local', writer: writer || null };
  if (channel) { try { channel.postMessage(evt); } catch (err) { /* канал закрыт */ } }
  emit(evt);
}

// оповещение для записей, сделанных в обход слоя (фоллбэк при недоступном слое)
export function notify(key) {
  ensureChannel();
  publish(key);
}

export function createClient(options) {
  const opts = options || {};
  const tenant = opts.tenant || null;
  let role = opts.role && ROLES[opts.role] ? opts.role : 'observer';
  const denials = [];
  const clientId = 'c' + Math.random().toString(36).slice(2, 9);
  ensureChannel();

  function assertAccess(key, write) {
    const s = scopeOf(key, tenant);
    if (s.scope === 'platform') {
      if (write && role !== 'methodist') return 'запись в эталон доступна только методисту платформы';
      return null;
    }
    if (s.scope === 'global') return null;
    // чужое пространство недоступно; методист платформы читает и пишет по всем арендаторам
    if (s.tenant && tenant && s.tenant !== tenant) return 'ключ принадлежит другому арендатору';
    return null;
  }

  const api = {
    role: () => role,
    roleName: () => (ROLES[role] || {}).name || role,
    tenant: () => tenant,
    setRole: (next) => { if (ROLES[next]) role = next; return role; },
    can: (perm) => ((ROLES[role] || {}).perms || []).indexOf(perm) >= 0,

    // отказ в праве — не тихий: он попадает в журнал и доступен интерфейсу
    deny: (perm, what) => {
      denials.push({ perm, what, role, at: Date.now() });
      return false;
    },
    denials: () => denials.slice(-20),

    async get(key, fallback) {
      const bad = assertAccess(key, false);
      if (bad) return { ok: false, error: bad, value: fallback };
      const raw = readRaw(key);
      if (raw === null) return { ok: true, value: fallback, version: 0 };
      let value = fallback;
      try { value = JSON.parse(raw); } catch (err) { value = fallback; }
      return { ok: true, value, version: (meta()[key] || {}).version || 1 };
    },

    // запись с проверкой версии: конфликт возвращается, а не затирается молча
    async set(key, value, options2) {
      const o = options2 || {};
      const bad = assertAccess(key, true);
      if (bad) { api.deny(o.perm || 'write', key); return { ok: false, error: bad }; }
      if (o.perm && !api.can(o.perm)) { api.deny(o.perm, key); return { ok: false, error: 'нет права ' + o.perm }; }
      const m = meta();
      const cur = m[key] || { version: 0 };
      if (o.expectedVersion !== undefined && o.expectedVersion !== cur.version) {
        return { ok: false, conflict: true, error: 'данные изменены другим пользователем', version: cur.version };
      }
      if (o.opId && cur.lastOpId === o.opId) return { ok: true, version: cur.version, idempotent: true };
      const next = JSON.stringify(value);
      // запись без изменений не создаёт версию и не рассылает событие — иначе подписчик зациклится
      if (readRaw(key) === next) return { ok: true, version: cur.version, unchanged: true };
      if (!writeRaw(key, next)) return { ok: false, error: 'хранилище недоступно' };
      m[key] = { version: (cur.version || 0) + 1, at: Date.now(), by: role, lastOpId: o.opId || null, writer: clientId };
      setMeta(m);
      publish(key, clientId);
      return { ok: true, version: m[key].version };
    },

    // транзакция: читает набор ключей, применяет функцию, пишет всё или ничего
    async tx(keys, fn, options2) {
      const o = options2 || {};
      const snapshot = {};
      const versions = {};
      for (const k of keys) {
        const r = await api.get(k, null);
        if (!r.ok) return { ok: false, error: r.error };
        snapshot[k] = r.value;
        versions[k] = r.version;
      }
      const next = fn(snapshot) || {};
      const changed = Object.keys(next);
      const m = meta();
      for (const k of changed) {
        const cur = (m[k] || {}).version || 0;
        if (versions[k] !== undefined && versions[k] !== cur) {
          return { ok: false, conflict: true, error: 'конфликт версий по ' + k };
        }
      }
      for (const k of changed) {
        const r = await api.set(k, next[k], { perm: o.perm, opId: o.opId ? o.opId + ':' + k : null });
        if (!r.ok) return r;
      }
      return { ok: true, changed };
    },

    // подписка вместо опроса: обработчик вызывается только при реальном изменении
    // opts.skipSelf — не присылать события о собственных записях этого же клиента
    subscribe(keys, cb, opts) {
      const o = opts || {};
      const entry = { keys: keys && keys.length ? keys : null, cb, owner: clientId, skipSelf: o.skipSelf !== false };
      listeners.push(entry);
      return () => {
        const i = listeners.indexOf(entry);
        if (i >= 0) listeners.splice(i, 1);
      };
    }
  };

  return api;
}
