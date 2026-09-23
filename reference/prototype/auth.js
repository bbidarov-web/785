// Аутентификация платформы: учётные записи, сессия, восстановление пароля.
//
// Здесь всё, что должно существовать до подключения сервера. Границы честные:
// пароль на стороне браузера хранить нельзя, поэтому в прототипе лежит не пароль,
// а его отпечаток; при переносе на сервер эти же вызовы уходят в API без изменения
// экранов — меняется только реализация store/hash. Точки замены помечены SERVER:.

const AUTH_KEY = 'k785_auth_accounts';
const SESSION_KEY = 'k785_auth_session';
const RESET_KEY = 'k785_auth_reset';
const OTP_KEY = 'k785_auth_otp';

// SERVER: заменить на bcrypt/argon2 на сервере. Клиентский отпечаток не является
// защитой — он только не даёт паролю лежать в хранилище открытым текстом.
function fingerprint(inn, login, password) {
  const s = String(inn || '') + '|' + String(login || '').toLowerCase() + '|' + String(password || '');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0; h1 = (h1 * 16777619) >>> 0;
    h2 = (h2 + c * (i + 7)) >>> 0; h2 = (h2 ^ (h2 << 5)) >>> 0;
  }
  return h1.toString(36) + '-' + h2.toString(36);
}

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return v === null || v === undefined ? fallback : v;
  } catch (err) { return fallback; }
}

function writeJson(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (err) { return false; }
}

function normInn(v) { return String(v || '').replace(/\D/g, ''); }
function normLogin(v) { return String(v || '').trim().toLowerCase(); }

// ИНН юрлица — 10 цифр, ИП — 12. Контрольные разряды считаются по алгоритму ФНС:
// без этой проверки опечатка в одной цифре создаёт «вторую клинику»
export function validInn(v) {
  const s = normInn(v);
  return s.length === 10 || s.length === 12;
}

// Контрольный разряд считается отдельно и служит ПРЕДУПРЕЖДЕНИЕМ, а не отказом:
// блокировать по нему нельзя, пока в базе живут условные ИНН демо-клиник, но
// промолчать об опечатке тоже нельзя — из-за неё заводится «вторая клиника».
// SERVER: там же, где проверка занятости, сверить ИНН со справочником ФНС
export function innChecksum(v) {
  const s = normInn(v);
  if (s.length !== 10 && s.length !== 12) return false;
  const d = s.split('').map(Number);
  const sum = (w) => w.reduce((a, k, i) => a + k * d[i], 0) % 11 % 10;
  if (s.length === 10) return sum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  return sum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10]
    && sum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}

// Требования к паролю названы словами, а не проверены молча: пользователь должен
// понимать, почему пароль не принят
export function passwordIssues(p) {
  const s = String(p || '');
  const out = [];
  if (s.length < 8) out.push('не короче 8 символов');
  if (!/[a-zа-яё]/i.test(s)) out.push('хотя бы одна буква');
  if (!/\d/.test(s)) out.push('хотя бы одна цифра');
  if (/^\s|\s$/.test(s)) out.push('без пробелов по краям');
  return out;
}

export function listAccounts() {
  const v = readJson(AUTH_KEY, []);
  return Array.isArray(v) ? v : [];
}

function saveAccounts(list) { return writeJson(AUTH_KEY, list); }

export function findAccount(inn, login) {
  const i = normInn(inn), l = normLogin(login);
  return listAccounts().filter(a => normInn(a.inn) === i && normLogin(a.login) === l)[0] || null;
}

// SERVER: POST /auth/register — сервер сам проверяет занятость и создаёт арендатора
export function register(o) {
  const inn = normInn(o.inn), login = normLogin(o.login);
  if (!validInn(inn)) return { ok: false, error: 'ИНН должен содержать 10 цифр для юрлица или 12 для ИП' };
  if (login.length < 3) return { ok: false, error: 'Логин не короче трёх символов' };
  const issues = passwordIssues(o.password);
  if (issues.length) return { ok: false, error: 'Пароль: ' + issues.join(', ') };
  if (String(o.password) !== String(o.password2)) return { ok: false, error: 'Пароли не совпадают' };
  if (findAccount(inn, login)) return { ok: false, error: 'Такой логин на этом ИНН уже зарегистрирован' };
  const list = listAccounts();
  const acc = {
    id: 'acc_' + Date.now().toString(36),
    inn, login,
    org: String(o.org || '').trim(),
    fio: String(o.fio || '').trim(),
    phone: String(o.phone || '').trim(),
    email: String(o.email || '').trim(),
    side: o.side === 'operator' ? 'operator' : 'clinic',
    role: o.role || (o.side === 'operator' ? 'platform_admin' : 'clinic_admin'),
    // сотрудник платформы не получает доступ по самой регистрации: иначе любой,
    // кто знает ИНН компании, заведёт себе учётную запись с доступом к данным клиник
    pending: o.side === 'operator',
    requestedRole: o.side === 'operator' ? (o.role || 'methodist') : '',
    hash: fingerprint(inn, login, o.password),
    twoFactor: o.twoFactor === true,
    twoFactorVia: o.twoFactorVia || 'смс',
    created: new Date().toISOString().slice(0, 10),
    lastLogin: ''
  };
  list.push(acc);
  saveAccounts(list);
  return {
    ok: true, account: acc, pending: acc.pending,
    warn: innChecksum(inn) ? '' : 'Контрольная сумма ИНН не сходится — проверьте цифры в профиле'
  };
}

// SERVER: GET /admin/accounts/pending — заявки на доступ сотрудников платформы
export function listPending() {
  return listAccounts().filter(a => a.pending);
}

// SERVER: POST /admin/accounts/:id/approve — роль назначает администратор,
// а не сам заявитель: запрошенная роль — только пожелание
export function approveAccount(id, role, by) {
  let found = null;
  saveAccounts(listAccounts().map(a => {
    if (a.id !== id) return a;
    found = Object.assign({}, a, {
      pending: false, role: role || a.requestedRole || a.role,
      approvedBy: by || 'администратор платформы',
      approvedAt: new Date().toISOString().slice(0, 10)
    });
    return found;
  }));
  return found ? { ok: true, account: found } : { ok: false, error: 'Заявка не найдена' };
}

// SERVER: POST /admin/accounts/:id/reject — запись удаляется целиком,
// чтобы логин освободился для повторной заявки
export function rejectAccount(id) {
  const before = listAccounts().length;
  saveAccounts(listAccounts().filter(a => a.id !== id));
  return { ok: listAccounts().length < before };
}

// SERVER: POST /auth/login-by-phone — исполнитель не заводит себе логин: его ключ
// в системе — ИНН клиники и рабочий телефон, по ним его заводит клиника
export function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 11 && (d[0] === '8' || d[0] === '7') ? '7' + d.slice(1) : d;
}

export function findByPhone(inn, phone) {
  const i = normInn(inn), p = normPhone(phone);
  if (!p) return null;
  return listAccounts().filter(a => normInn(a.inn) === i && normPhone(a.phone) === p)[0] || null;
}

export function loginByPhone(inn, phone, password) {
  const acc = findByPhone(inn, phone);
  // ответ не различает «нет такого телефона» и «неверный пароль»
  if (!acc || acc.hash !== fingerprint(normInn(inn), acc.login, password)) {
    return { ok: false, error: 'Неверный ИНН клиники, телефон или пароль' };
  }
  if (acc.blocked) return { ok: false, error: 'Доступ приостановлен. Обратитесь к администратору клиники.' };
  if (acc.pending) return { ok: false, error: 'Доступ ещё не подтверждён клиникой.' };
  return { ok: true, session: openSession(acc) };
}

// SERVER: POST /auth/login → сессионный cookie httpOnly + отдельный шаг 2FA
export function login(inn, loginName, password) {
  const acc = findAccount(inn, loginName);
  // ответ намеренно не различает «нет такого логина» и «неверный пароль»:
  // иначе форма превращается в средство проверки существующих учётных записей
  if (!acc || acc.hash !== fingerprint(normInn(inn), loginName, password)) {
    return { ok: false, error: 'Неверный ИНН, логин или пароль' };
  }
  if (acc.blocked) return { ok: false, error: 'Доступ приостановлен. Обратитесь к администратору платформы.' };
  // проверка после пароля: иначе по ответу можно узнать, что такой логин существует
  if (acc.pending) return { ok: false, error: 'Заявка на доступ отправлена и ждёт подтверждения администратора платформы.' };
  if (acc.twoFactor) {
    const code = String(100000 + Math.floor(Math.random() * 899999));
    writeJson(OTP_KEY, { id: acc.id, code, via: acc.twoFactorVia, at: Date.now() });
    // SERVER: код уходит по смс или звонком и никогда не возвращается в ответе
    return { ok: true, needOtp: true, via: acc.twoFactorVia, phone: acc.phone };
  }
  return { ok: true, session: openSession(acc) };
}

// SERVER: POST /auth/2fa/verify — код живёт на сервере, в ответ приходит сессия.
// Здесь код хранится локально и возвращается на экран: без шлюза связи иначе
// войти невозможно, и это честнее, чем имитировать доставку
export function verifyOtp(code) {
  const rec = readJson(OTP_KEY, null);
  if (!rec) return { ok: false, error: 'Код не запрашивался' };
  if (Date.now() - rec.at > 5 * 60 * 1000) return { ok: false, error: 'Код просрочен, запросите новый' };
  if (String(code).trim() !== rec.code) return { ok: false, error: 'Код не совпадает' };
  const acc = listAccounts().filter(a => a.id === rec.id)[0];
  if (!acc) return { ok: false, error: 'Учётная запись не найдена' };
  try { window.localStorage.removeItem(OTP_KEY); } catch (err) { /* нечего удалять */ }
  return { ok: true, session: openSession(acc) };
}

export function resendOtp() {
  const rec = readJson(OTP_KEY, null);
  if (!rec) return { ok: false, error: 'Сначала введите логин и пароль' };
  const code = String(100000 + Math.floor(Math.random() * 899999));
  writeJson(OTP_KEY, Object.assign({}, rec, { code, at: Date.now() }));
  return { ok: true, via: rec.via };
}

function openSession(acc) {
  const list = listAccounts().map(a => a.id === acc.id
    ? Object.assign({}, a, { lastLogin: new Date().toISOString().slice(0, 16).replace('T', ' ') }) : a);
  saveAccounts(list);
  const s = {
    accountId: acc.id, inn: acc.inn, login: acc.login, side: acc.side,
    role: acc.role, org: acc.org, fio: acc.fio,
    at: Date.now()
  };
  writeJson(SESSION_KEY, s);
  return s;
}

export function session() { return readJson(SESSION_KEY, null); }

export function logout() {
  try { window.localStorage.removeItem(SESSION_KEY); } catch (err) { /* нечего удалять */ }
}

// SERVER: POST /auth/password/request — ссылка уходит на почту, токен живёт на сервере
export function requestReset(inn, loginName) {
  const acc = findAccount(inn, loginName);
  // ответ одинаковый независимо от того, найдена запись или нет
  const answer = { ok: true, sent: true };
  if (!acc) return answer;
  const code = String(100000 + Math.floor(Math.random() * 899999));
  writeJson(RESET_KEY, { id: acc.id, code, at: Date.now() });
  // SERVER: код сброса уходит на почту или по смс, в ответе его нет
  return Object.assign({}, answer, { phone: acc.phone, email: acc.email });
}

export function confirmReset(code, password, password2) {
  const rec = readJson(RESET_KEY, null);
  if (!rec) return { ok: false, error: 'Код не запрашивался' };
  if (Date.now() - rec.at > 30 * 60 * 1000) return { ok: false, error: 'Код просрочен, запросите новый' };
  if (String(code).trim() !== rec.code) return { ok: false, error: 'Код не совпадает' };
  const issues = passwordIssues(password);
  if (issues.length) return { ok: false, error: 'Пароль: ' + issues.join(', ') };
  if (String(password) !== String(password2)) return { ok: false, error: 'Пароли не совпадают' };
  const list = listAccounts().map(a => a.id === rec.id
    ? Object.assign({}, a, { hash: fingerprint(a.inn, a.login, password) }) : a);
  saveAccounts(list);
  try { window.localStorage.removeItem(RESET_KEY); } catch (err) { /* нечего удалять */ }
  return { ok: true };
}

// SERVER: POST /auth/password/change — старый пароль проверяется на сервере
export function changePassword(accountId, oldPass, newPass, newPass2) {
  const acc = listAccounts().filter(a => a.id === accountId)[0];
  if (!acc) return { ok: false, error: 'Учётная запись не найдена' };
  if (acc.hash !== fingerprint(acc.inn, acc.login, oldPass)) return { ok: false, error: 'Текущий пароль неверен' };
  const issues = passwordIssues(newPass);
  if (issues.length) return { ok: false, error: 'Новый пароль: ' + issues.join(', ') };
  if (String(newPass) !== String(newPass2)) return { ok: false, error: 'Новые пароли не совпадают' };
  if (String(newPass) === String(oldPass)) return { ok: false, error: 'Новый пароль совпадает с текущим' };
  saveAccounts(listAccounts().map(a => a.id === accountId
    ? Object.assign({}, a, { hash: fingerprint(a.inn, a.login, newPass), pwdChanged: new Date().toISOString().slice(0, 10) }) : a));
  return { ok: true };
}

// администратор платформы меняет пароль сотрудника, не зная старого:
// действие необратимое, поэтому вызывающая сторона обязана записать его в журнал
export function adminSetPassword(accountId, newPass) {
  const acc = listAccounts().filter(a => a.id === accountId)[0];
  if (!acc) return { ok: false, error: 'Учётная запись не найдена' };
  const issues = passwordIssues(newPass);
  if (issues.length) return { ok: false, error: 'Пароль: ' + issues.join(', ') };
  saveAccounts(listAccounts().map(a => a.id === accountId
    ? Object.assign({}, a, { hash: fingerprint(a.inn, a.login, newPass), pwdChanged: new Date().toISOString().slice(0, 10), mustChange: true }) : a));
  return { ok: true };
}

export function setTwoFactor(accountId, on, via) {
  saveAccounts(listAccounts().map(a => a.id === accountId
    ? Object.assign({}, a, { twoFactor: !!on, twoFactorVia: via || a.twoFactorVia || 'смс' }) : a));
  return { ok: true };
}

export function updateAccount(accountId, patch) {
  saveAccounts(listAccounts().map(a => a.id === accountId ? Object.assign({}, a, patch || {}) : a));
  return { ok: true };
}

// учётные записи сотрудников платформы по всем четырём ролям: рабочее место у каждой своё,
// и увидеть его можно только войдя под соответствующей записью
const OPS = [
  { login: 'operator', password: 'platform2026', role: 'platform_admin', fio: 'Ковалёв И. С.', phone: '+7 916 100-00-01', email: 'admin@k785.ru' },
  { login: 'metodist', password: 'metodist2026', role: 'methodist', fio: 'Николаева Е. В.', phone: '+7 916 100-00-02', email: 'method@k785.ru' },
  { login: 'manager', password: 'manager2026', role: 'sales_manager', fio: 'Гусев Р. А.', phone: '+7 916 100-00-03', email: 'sales@k785.ru' },
  { login: 'saleshead', password: 'saleshead2026', role: 'sales_head', fio: 'Лазарева Т. М.', phone: '+7 916 100-00-04', email: 'head@k785.ru' }
];

function opAccount(o) {
  return {
    id: 'acc_' + o.login, inn: '7726345678', login: o.login,
    org: 'ООО «Стандарт Качества»', fio: o.fio, phone: o.phone, email: o.email,
    side: 'operator', role: o.role,
    hash: fingerprint('7726345678', o.login, o.password),
    twoFactor: false, twoFactorVia: 'смс', created: '01.02.2026', lastLogin: ''
  };
}

// демо-записи, чтобы экран входа работал сразу: создаются один раз и только
// если учётных записей ещё нет
// В сборке для переноса демо-записи выключены: первый администратор платформы
// создаётся на сервере вручную (см. SERVER.md), остальные — через заявку и подтверждение.
// Для локальной разработки фикстуры включаются явно: window.K785_DEMO = true до загрузки
export function seedDemo() {
  if (typeof window === 'undefined' || window.K785_DEMO !== true) return;
  // миграция ранних демо-записей: ИНН клиники был условным и не совпадал с реестром,
  // поэтому вход по показанным на форме реквизитам не находил учётную запись
  const cur = listAccounts();
  if (cur.length) {
    const moved = cur.map(a => normInn(a.inn) === '7701234567'
      ? Object.assign({}, a, { inn: '7712345678', hash: fingerprint('7712345678', a.login, a.login === 'medplus' ? 'medplus2026' : 'vkk2026lead') })
      : a);
    // ролевые записи добавляем и в уже засеянное хранилище: иначе рабочее место
    // методиста и менеджера не открыть без полной очистки браузера
    const add = OPS.filter(o => !moved.some(a => normLogin(a.login) === o.login)).map(opAccount);
    // то же для исполнителей: кабинет медсестры иначе не открыть на уже запущенном демо
    const nurses = [
      { login: 'petrova', password: 'nurse2026', fio: 'Петрова В. В.', phone: '+7 916 000-00-03', email: 'petrova@medplus.ru' },
      { login: 'sidorova', password: 'nurse2026', fio: 'Сидорова В. В.', phone: '+7 916 000-00-04', email: 'sidorova@medplus.ru' }
    ].filter(n => !moved.some(a => normLogin(a.login) === n.login)).map(n => ({
      id: 'acc_' + n.login, inn: '7712345678', login: n.login,
      org: 'ООО «Медицина Плюс»', fio: n.fio, phone: n.phone, email: n.email,
      side: 'clinic', role: 'nurse', hash: fingerprint('7712345678', n.login, n.password),
      twoFactor: false, twoFactorVia: 'смс', created: '01.02.2026', lastLogin: ''
    }));
    if (add.length || nurses.length) { saveAccounts(moved.concat(add).concat(nurses)); return; }
    if (JSON.stringify(moved) !== JSON.stringify(cur)) saveAccounts(moved);
    return;
  }
  const mk = (o) => {
    const acc = Object.assign({
      id: 'acc_' + o.login, created: '01.02.2026', lastLogin: '',
      twoFactor: false, twoFactorVia: 'смс'
    }, o);
    acc.hash = fingerprint(acc.inn, acc.login, o.password);
    delete acc.password;
    return acc;
  };
  saveAccounts([
    // ИНН совпадает с арендатором клиники в реестре: сессия задаёт арендатора,
    // и расхождение открыло бы кабинет с пустыми данными
    mk({ inn: '7712345678', login: 'medplus', password: 'medplus2026', side: 'clinic', role: 'clinic_admin', org: 'ООО «Медицина Плюс»', fio: 'Смирнов А. П.', phone: '+7 916 000-00-01', email: 'admin@medplus.ru' }),
    mk({ inn: '7712345678', login: 'ivanova', password: 'vkk2026lead', side: 'clinic', role: 'vkk_lead', org: 'ООО «Медицина Плюс»', fio: 'Иванова М. А.', phone: '+7 916 000-00-02', email: 'vkk@medplus.ru' }),
    // исполнитель: входит по ИНН клиники и телефону, видит только свои назначения
    mk({ inn: '7712345678', login: 'petrova', password: 'nurse2026', side: 'clinic', role: 'nurse', org: 'ООО «Медицина Плюс»', fio: 'Петрова В. В.', phone: '+7 916 000-00-03', email: 'petrova@medplus.ru' }),
    mk({ inn: '7712345678', login: 'sidorova', password: 'nurse2026', side: 'clinic', role: 'nurse', org: 'ООО «Медицина Плюс»', fio: 'Сидорова В. В.', phone: '+7 916 000-00-04', email: 'sidorova@medplus.ru' })
  ].concat(OPS.map(opAccount)));
}
