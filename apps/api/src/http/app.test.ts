import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { buildContainerFromRepos, type Container } from '../container.js';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | null {
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  for (const c of arr) {
    if (c.startsWith(name + '=')) return c.split(';')[0]!.slice(name.length + 1);
  }
  return null;
}

describe('HTTP: /api/auth и защита эндпоинтов правами', () => {
  let app: FastifyInstance;
  let container: Container;
  let repos: ReturnType<typeof createMemoryRepos>;

  beforeEach(async () => {
    repos = createMemoryRepos();
    container = buildContainerFromRepos(repos);
    app = await buildApp(container, { cookieSecret: 'x'.repeat(32), corsOrigin: 'http://localhost:3000', logger: false });
    await app.ready();
  });

  it('health отвечает без авторизации', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it('защищённый эндпоинт без cookie отдаёт 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executor/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('регистрация клиники → логин → сессионная cookie → доступ к защищённому эндпоинту', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'Смирнов А. П.', side: 'clinic' },
    });
    expect(reg.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { inn: '7712345671', login: 'medplus', password: 'medplus2026' },
    });
    expect(login.statusCode).toBe(200);
    const sessionCookie = extractCookie(login.headers['set-cookie'], 'k785_session');
    expect(sessionCookie).toBeTruthy();

    const session = await app.inject({ method: 'GET', url: '/api/auth/session', cookies: { k785_session: sessionCookie! } });
    expect(session.json().session.login).toBe('medplus');
  });

  it('исполнитель может увидеть только свои назначения через /api/executor/overview', async () => {
    const authSvc = container.auth;
    const reg = await authSvc.register({
      inn: '7712345671', login: 'petrova', password: 'nurse2026', password2: 'nurse2026',
      fio: 'Петрова В. В.', phone: '+79160000003', side: 'clinic', role: 'nurse',
    });
    if (!reg.ok) throw new Error('setup failed');
    await repos.channels.set('tenant', '7712345671', 'docasg', { 'Положение о ВКК': 'Петрова В. В.' }, { updatedBy: null });

    const login = await app.inject({
      method: 'POST', url: '/api/auth/login-by-phone',
      payload: { inn: '7712345671', phone: '+79160000003', password: 'nurse2026' },
    });
    const sessionCookie = extractCookie(login.headers['set-cookie'], 'k785_session')!;

    const overview = await app.inject({ method: 'GET', url: '/api/executor/overview', cookies: { k785_session: sessionCookie } });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().overview.docs.map((d: { name: string }) => d.name)).toEqual(['Положение о ВКК']);
  });

  it('без права doc:grant выдача документа отклоняется с 403', async () => {
    const reg = await container.auth.register({
      inn: '7712345671', login: 'ivanova', password: 'vkk2026lead', password2: 'vkk2026lead',
      fio: 'Иванова М. А.', side: 'clinic', role: 'vkk_lead',
    });
    if (!reg.ok) throw new Error('setup failed');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7712345671', login: 'ivanova', password: 'vkk2026lead' } });
    const sessionCookie = extractCookie(login.headers['set-cookie'], 'k785_session')!;

    const grant = await app.inject({
      method: 'POST', url: '/api/documents/grant', cookies: { k785_session: sessionCookie },
      payload: { tenantInn: '7712345671', stage: 's1', code: 'DOC-1', name: 'Документ', paid: true },
    });
    expect(grant.statusCode).toBe(403);
  });

  it('повышение роли требует подтверждения ДРУГИМ администратором (вторая рука)', async () => {
    const admin1 = await container.auth.register({ inn: '7726345678', login: 'admin1', password: 'platform2026', password2: 'platform2026', fio: 'Admin One', side: 'operator', role: 'platform_admin' });
    const admin2 = await container.auth.register({ inn: '7726345678', login: 'admin2', password: 'platform2026', password2: 'platform2026', fio: 'Admin Two', side: 'operator', role: 'platform_admin' });
    if (!admin1.ok || !admin2.ok) throw new Error('setup failed');
    // approve обеих заявок напрямую через сервис — это не тест самого approve-эндпоинта
    await repos.accounts.update(admin1.account.id, { pending: false });
    await repos.accounts.update(admin2.account.id, { pending: false });
    const target = await container.auth.register({ inn: '7726345678', login: 'methodist2', password: 'metodist2026', password2: 'metodist2026', fio: 'M', side: 'operator', role: 'methodist' });
    if (!target.ok) throw new Error('setup failed');
    await repos.accounts.update(target.account.id, { pending: false });

    async function loginAs(login: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7726345678', login, password: 'platform2026' } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }

    const cookie1 = await loginAs('admin1');
    const reqRes = await app.inject({
      method: 'POST', url: '/api/admin/role-elevation/request', cookies: { k785_session: cookie1 },
      payload: { accountId: target.account.id, newRole: 'platform_admin' },
    });
    expect(reqRes.statusCode).toBe(200);
    const requestId = reqRes.json().request.id;

    // тот же администратор не может подтвердить свой собственный запрос
    const selfConfirm = await app.inject({ method: 'POST', url: `/api/second-hand/${requestId}/confirm`, cookies: { k785_session: cookie1 } });
    expect(selfConfirm.json().ok).toBe(false);

    const cookie2 = await loginAs('admin2');
    const confirm = await app.inject({ method: 'POST', url: `/api/second-hand/${requestId}/confirm`, cookies: { k785_session: cookie2 } });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().ok).toBe(true);

    const updated = await repos.accounts.findById(target.account.id);
    expect(updated?.role).toBe('platform_admin');
  });

  it('мобильный обход: список → ответ на пункт → завершение, полный HTTP-цикл', async () => {
    await repos.channels.set('platform', null, 'checklists', [
      { name: 'Чек-лист аудита стерилизационной', items: ['Режимы стерилизации соблюдаются?', 'Индикаторы вклеены?'] },
    ], { updatedBy: null });
    const reg = await container.auth.register({
      inn: '7712345671', login: 'auditor1', password: 'auditor2026', password2: 'auditor2026',
      fio: 'Сидорова В. В.', side: 'clinic', role: 'auditor',
    });
    if (!reg.ok) throw new Error('setup failed');
    await repos.channels.set('tenant', '7712345671', 'audit_plan', [
      { id: 'p1', check: 'Чек-лист аудита стерилизационной', who: 'Сидорова В. В.', object: 'Стерилизационная', kind: 'плановая', date: '01.03.2026' },
    ], { updatedBy: null });

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7712345671', login: 'auditor1', password: 'auditor2026' } });
    const cookie = extractCookie(login.headers['set-cookie'], 'k785_session')!;

    const list = await app.inject({ method: 'GET', url: '/api/walk/plan', cookies: { k785_session: cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().walks).toHaveLength(1);
    expect(list.json().walks[0].total).toBe(2);

    const answer1 = await app.inject({
      method: 'POST', url: '/api/walk/plan/p1/answer', cookies: { k785_session: cookie },
      payload: { index: 0, answer: 'ok', opId: 'op-1' },
    });
    expect(answer1.statusCode).toBe(200);

    const answer2 = await app.inject({
      method: 'POST', url: '/api/walk/plan/p1/answer', cookies: { k785_session: cookie },
      payload: { index: 1, answer: 'bad', comment: 'Индикаторы не вклеены', opId: 'op-2' },
    });
    expect(answer2.statusCode).toBe(200);
    expect(answer2.json().detail.bad).toBe(1);

    const finish = await app.inject({ method: 'POST', url: '/api/walk/plan/p1/finish', cookies: { k785_session: cookie }, payload: { opId: 'op-finish' } });
    expect(finish.statusCode).toBe(200);
    expect(finish.json()).toMatchObject({ ok: true, bad: 1, total: 2 });
  });

  it('обход: чужая проверка (по who) не выполняется — 400, а не молчаливый успех', async () => {
    await repos.channels.set('platform', null, 'checklists', [{ name: 'ЧЛ', items: ['п1'] }], { updatedBy: null });
    const reg = await container.auth.register({
      inn: '7712345671', login: 'auditor2', password: 'auditor2026', password2: 'auditor2026',
      fio: 'Сидорова В. В.', side: 'clinic', role: 'auditor',
    });
    if (!reg.ok) throw new Error('setup failed');
    await repos.channels.set('tenant', '7712345671', 'audit_plan', [
      { id: 'p1', check: 'ЧЛ', who: 'Другой Человек' },
    ], { updatedBy: null });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7712345671', login: 'auditor2', password: 'auditor2026' } });
    const cookie = extractCookie(login.headers['set-cookie'], 'k785_session')!;
    const res = await app.inject({
      method: 'POST', url: '/api/walk/plan/p1/answer', cookies: { k785_session: cookie },
      payload: { index: 0, answer: 'ok', opId: 'op-1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('фото обхода: сохраняется и отдаётся только тому же арендатору', async () => {
    await repos.channels.set('platform', null, 'checklists', [{ name: 'ЧЛ', items: ['п1'] }], { updatedBy: null });
    const reg = await container.auth.register({
      inn: '7712345671', login: 'auditor3', password: 'auditor2026', password2: 'auditor2026',
      fio: 'Сидорова В. В.', side: 'clinic', role: 'auditor',
    });
    if (!reg.ok) throw new Error('setup failed');
    await repos.channels.set('tenant', '7712345671', 'audit_plan', [{ id: 'p1', check: 'ЧЛ', who: 'Сидорова В. В.' }], { updatedBy: null });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7712345671', login: 'auditor3', password: 'auditor2026' } });
    const cookie = extractCookie(login.headers['set-cookie'], 'k785_session')!;
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const answer = await app.inject({
      method: 'POST', url: '/api/walk/plan/p1/answer', cookies: { k785_session: cookie },
      payload: { index: 0, answer: 'bad', photoBase64: png, opId: 'op-1' },
    });
    const fileId = answer.json().detail.items[0].photoFileId;
    expect(fileId).toBeTruthy();

    const file = await app.inject({ method: 'GET', url: `/api/files/${fileId}`, cookies: { k785_session: cookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');

    // другая клиника не видит чужой файл, даже зная его id
    const otherReg = await container.auth.register({ inn: '5001007322', login: 'other', password: 'other2026', password2: 'other2026', fio: 'X', side: 'clinic' });
    if (!otherReg.ok) throw new Error('setup failed');
    const otherLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '5001007322', login: 'other', password: 'other2026' } });
    const otherCookie = extractCookie(otherLogin.headers['set-cookie'], 'k785_session')!;
    const forbidden = await app.inject({ method: 'GET', url: `/api/files/${fileId}`, cookies: { k785_session: otherCookie } });
    expect(forbidden.statusCode).toBe(404);
  });

  it('клиника: штат → назначение → план проверок → обход → CAPA, полный HTTP-цикл', async () => {
    await repos.channels.set('platform', null, 'checklists', [
      { name: 'Чек-лист аудита стерилизационной', items: ['Режимы соблюдаются?', 'Индикаторы вклеены?'] },
    ], { updatedBy: null });

    const adminReg = await container.auth.register({ inn: '7712345671', login: 'clinicadmin', password: 'admin2026aa', password2: 'admin2026aa', fio: 'Смирнов А. П.', side: 'clinic', role: 'clinic_admin' });
    const vkkReg = await container.auth.register({ inn: '7712345671', login: 'vkk', password: 'vkk2026lead', password2: 'vkk2026lead', fio: 'Иванова М. А.', side: 'clinic', role: 'vkk_lead' });
    const auditorReg = await container.auth.register({ inn: '7712345671', login: 'auditor', password: 'auditor2026', password2: 'auditor2026', fio: 'Сидорова В. В.', side: 'clinic', role: 'auditor' });
    if (!adminReg.ok || !vkkReg.ok || !auditorReg.ok) throw new Error('setup failed');

    async function loginAs(login: string, password: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7712345671', login, password } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }
    const adminCookie = await loginAs('clinicadmin', 'admin2026aa');
    const vkkCookie = await loginAs('vkk', 'vkk2026lead');
    const auditorCookie = await loginAs('auditor', 'auditor2026');

    // 1) администратор клиники заводит сотрудника
    const staffRes = await app.inject({ method: 'POST', url: '/api/clinic/staff', cookies: { k785_session: adminCookie }, payload: { fio: 'Сидорова В. В.', pos: 'Врач-эпидемиолог' } });
    expect(staffRes.statusCode).toBe(200);

    // vkk_lead не управляет штатом напрямую (нет staff:manage)
    const staffDenied = await app.inject({ method: 'POST', url: '/api/clinic/staff', cookies: { k785_session: vkkCookie }, payload: { fio: 'X', pos: 'Y' } });
    expect(staffDenied.statusCode).toBe(403);

    // 2) vkk_lead назначает ответственного за документ
    const asgRes = await app.inject({ method: 'PUT', url: '/api/clinic/assignments/' + encodeURIComponent('Положение о ВКК'), cookies: { k785_session: vkkCookie }, payload: { who: 'Сидорова В. В.' } });
    expect(asgRes.statusCode).toBe(200);

    // 3) vkk_lead ставит проверку в план
    const planRes = await app.inject({
      method: 'POST', url: '/api/clinic/plan', cookies: { k785_session: vkkCookie },
      payload: { date: '01.03.2026', dir: 'Чек-лист аудита стерилизационной', object: 'Стерилизационная', who: 'Сидорова В. В.', kind: 'плановая', check: 'Чек-лист аудита стерилизационной' },
    });
    expect(planRes.statusCode).toBe(200);
    const planId = planRes.json().item.id;

    // 4) аудитор видит проверку в обходе и проводит её с нарушением
    const walkList = await app.inject({ method: 'GET', url: '/api/walk/plan', cookies: { k785_session: auditorCookie } });
    expect(walkList.json().walks.map((w: { planId: string }) => w.planId)).toEqual([planId]);

    await app.inject({ method: 'POST', url: `/api/walk/plan/${planId}/answer`, cookies: { k785_session: auditorCookie }, payload: { index: 0, answer: 'ok', opId: 'op-1' } });
    await app.inject({ method: 'POST', url: `/api/walk/plan/${planId}/answer`, cookies: { k785_session: auditorCookie }, payload: { index: 1, answer: 'bad', comment: 'Индикаторы просрочены', opId: 'op-2' } });
    const finish = await app.inject({ method: 'POST', url: `/api/walk/plan/${planId}/finish`, cookies: { k785_session: auditorCookie }, payload: { opId: 'op-finish' } });
    expect(finish.json()).toMatchObject({ ok: true, bad: 1 });

    // 5) аудитор фиксирует нарушение, но не может сам завести мероприятие
    const findings = await app.inject({ method: 'GET', url: '/api/clinic/capa/findings', cookies: { k785_session: auditorCookie } });
    expect(findings.json().findings).toHaveLength(1);
    const capaByAuditor = await app.inject({ method: 'POST', url: '/api/clinic/capa', cookies: { k785_session: auditorCookie }, payload: { planId, itemIndex: 1 } });
    expect(capaByAuditor.statusCode).toBe(403);

    // 6) vkk_lead планирует корректирующее мероприятие по этому нарушению
    const capaRes = await app.inject({ method: 'POST', url: '/api/clinic/capa', cookies: { k785_session: vkkCookie }, payload: { planId, itemIndex: 1, who: 'Сидорова В. В.', due: '15.03.2026' } });
    expect(capaRes.statusCode).toBe(200);
    const capaId = capaRes.json().item.id;

    // находка больше не висит открытой
    const findingsAfter = await app.inject({ method: 'GET', url: '/api/clinic/capa/findings', cookies: { k785_session: vkkCookie } });
    expect(findingsAfter.json().findings).toHaveLength(0);

    // 7) исполнитель, на которого заведено мероприятие, закрывает его сам
    const closeRes = await app.inject({ method: 'PUT', url: `/api/clinic/capa/${capaId}/status`, cookies: { k785_session: auditorCookie }, payload: { status: 'done' } });
    expect(closeRes.statusCode).toBe(200);
    expect(closeRes.json().item.status).toBe('done');
  });

  it('панель: методист публикует этапы → клиника оплачивает и получает документ, менеджер не может публиковать эталон', async () => {
    const methodistReg = await container.auth.register({ inn: '7726345678', login: 'metodist', password: 'metodist2026', password2: 'metodist2026', fio: 'Николаева Е. В.', side: 'operator', role: 'methodist' });
    const managerReg = await container.auth.register({ inn: '7726345678', login: 'manager1', password: 'manager2026', password2: 'manager2026', fio: 'Гусев Р. А.', side: 'operator', role: 'sales_manager' });
    const adminReg = await container.auth.register({ inn: '7726345678', login: 'admin1', password: 'platform2026', password2: 'platform2026', fio: 'Admin One', side: 'operator', role: 'platform_admin' });
    if (!methodistReg.ok || !managerReg.ok || !adminReg.ok) throw new Error('setup failed');
    await repos.accounts.update(methodistReg.account.id, { pending: false });
    await repos.accounts.update(managerReg.account.id, { pending: false });
    await repos.accounts.update(adminReg.account.id, { pending: false });
    const clinicReg = await container.auth.register({ inn: '7712345671', login: 'clinicadmin', password: 'admin2026aa', password2: 'admin2026aa', fio: 'Смирнов А. П.', side: 'clinic', role: 'clinic_admin' });
    if (!clinicReg.ok) throw new Error('setup failed');

    async function loginAs(inn: string, login: string, password: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn, login, password } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }
    const methodistCookie = await loginAs('7726345678', 'metodist', 'metodist2026');
    const managerCookie = await loginAs('7726345678', 'manager1', 'manager2026');
    const adminCookie = await loginAs('7726345678', 'admin1', 'platform2026');
    const clinicCookie = await loginAs('7712345671', 'clinicadmin', 'admin2026aa');

    const stages = [
      {
        code: 1, name: 'Базовая система', price: 68000,
        blocks: [{ key: 'b01', num: '01', name: 'Управление ВКК', docs: [
          { name: 'Приказ о создании комиссии по внутреннему контролю', template: 'Приказ · {{org}} · ИНН {{inn}} · ответственный: {{responsible}}' },
        ] }],
      },
      { code: 2, name: 'Организационный пакет', price: 68000, blocks: [] },
    ];

    // менеджер не может публиковать эталон
    const deniedPublish = await app.inject({ method: 'PUT', url: '/api/panel/stage-docs', cookies: { k785_session: managerCookie }, payload: stages });
    expect(deniedPublish.statusCode).toBe(403);

    // методист заводит запрос на публикацию каталога этапов — это одна из семи операций второй руки (standard:publish)
    const publish = await app.inject({ method: 'PUT', url: '/api/panel/stage-docs', cookies: { k785_session: methodistCookie }, payload: stages });
    expect(publish.statusCode).toBe(200);
    const publishRequestId = publish.json().secondHandRequest.id;

    // менеджер по продажам не может подтвердить публикацию эталона (нет second:standard)
    const managerConfirm = await app.inject({ method: 'POST', url: `/api/second-hand/${publishRequestId}/confirm`, cookies: { k785_session: managerCookie } });
    expect(managerConfirm.statusCode).toBe(403);
    // сам методист тоже не может — своей рукой нельзя
    const selfConfirmPublish = await app.inject({ method: 'POST', url: `/api/second-hand/${publishRequestId}/confirm`, cookies: { k785_session: methodistCookie } });
    expect(selfConfirmPublish.json().ok).toBe(false);
    // администратор платформы подтверждает — каталог выходит в публикацию
    const confirmPublish = await app.inject({ method: 'POST', url: `/api/second-hand/${publishRequestId}/confirm`, cookies: { k785_session: adminCookie } });
    expect(confirmPublish.statusCode).toBe(200);

    // клиника видит этап и заказывает оплату
    const view = await app.inject({ method: 'GET', url: '/api/clinic/stages', cookies: { k785_session: clinicCookie } });
    expect(view.json().stages[0].payment.status).toBe('none');
    const payReq = await app.inject({ method: 'POST', url: '/api/clinic/stages/1/request-payment', cookies: { k785_session: clinicCookie } });
    expect(payReq.statusCode).toBe(200);

    // методист не может подтвердить оплату (нет money:write)
    const deniedConfirm = await app.inject({ method: 'POST', url: `/api/panel/stage-payments/7712345671/1/confirm`, cookies: { k785_session: methodistCookie } });
    expect(deniedConfirm.statusCode).toBe(403);

    // менеджер подтверждает оплату (ниже порога второй руки)
    const confirm = await app.inject({ method: 'POST', url: `/api/panel/stage-payments/7712345671/1/confirm`, cookies: { k785_session: managerCookie } });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().payment.status).toBe('paid');

    // документ клиники ещё не выдан — не отдаётся
    const notGranted = await app.inject({ method: 'GET', url: '/api/clinic/documents/' + encodeURIComponent('Приказ о создании комиссии по внутреннему контролю') + '/content', cookies: { k785_session: clinicCookie } });
    expect(notGranted.statusCode).toBe(400);

    // методист выдаёт документ
    const grant = await app.inject({
      method: 'POST', url: '/api/documents/grant', cookies: { k785_session: methodistCookie },
      payload: { tenantInn: '7712345671', stage: '1', code: 'Приказ о создании комиссии по внутреннему контролю', name: 'Приказ о создании комиссии по внутреннему контролю', paid: true },
    });
    expect(grant.statusCode).toBe(200);

    const content = await app.inject({ method: 'GET', url: '/api/clinic/documents/' + encodeURIComponent('Приказ о создании комиссии по внутреннему контролю') + '/content', cookies: { k785_session: clinicCookie } });
    expect(content.statusCode).toBe(200);
    expect(content.json().content).toContain('ИНН 7712345671');

    // этап 2 заблокирован, пока платформа не приняла этап 1 — оплата сама по себе не открывает следующий
    const viewAfterPay = await app.inject({ method: 'GET', url: '/api/clinic/stages', cookies: { k785_session: clinicCookie } });
    expect(viewAfterPay.json().stages[1].locked).toBe(true);
    const blockedOrder = await app.inject({ method: 'POST', url: '/api/clinic/stages/2/request-payment', cookies: { k785_session: clinicCookie } });
    expect(blockedOrder.statusCode).toBe(400);

    // клиника сама не может принять свой этап — это делает платформа (doc:grant)
    const clinicAccept = await app.inject({ method: 'POST', url: '/api/panel/stage-payments/7712345671/1/accept', cookies: { k785_session: clinicCookie } });
    expect(clinicAccept.statusCode).toBe(403);

    // методист принимает оплаченный этап 1 — второй этап открывается
    const accept = await app.inject({ method: 'POST', url: '/api/panel/stage-payments/7712345671/1/accept', cookies: { k785_session: methodistCookie } });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().payment.accepted).toBe(true);

    const viewAfterAccept = await app.inject({ method: 'GET', url: '/api/clinic/stages', cookies: { k785_session: clinicCookie } });
    expect(viewAfterAccept.json().stages[1].locked).toBe(false);
    const secondOrder = await app.inject({ method: 'POST', url: '/api/clinic/stages/2/request-payment', cookies: { k785_session: clinicCookie } });
    expect(secondOrder.statusCode).toBe(200);
  });

  it('крупная оплата этапа (от 100 000 ₽) идёт через общий эндпоинт второй руки', async () => {
    const managerReg = await container.auth.register({ inn: '7726345678', login: 'manager2', password: 'manager2026', password2: 'manager2026', fio: 'Гусев Р. А.', side: 'operator', role: 'sales_manager' });
    const headReg = await container.auth.register({ inn: '7726345678', login: 'head1', password: 'saleshead2026', password2: 'saleshead2026', fio: 'Лазарева Т. М.', side: 'operator', role: 'sales_head' });
    if (!managerReg.ok || !headReg.ok) throw new Error('setup failed');
    await repos.accounts.update(managerReg.account.id, { pending: false });
    await repos.accounts.update(headReg.account.id, { pending: false });
    await container.auth.register({ inn: '7712345671', login: 'clinicadmin2', password: 'admin2026aa', password2: 'admin2026aa', fio: 'X', side: 'clinic', role: 'clinic_admin' });
    await repos.channels.set('platform', null, 'stage_docs', [{ code: 9, name: 'Дорогой этап', price: 150000, blocks: [] }], { updatedBy: null });

    async function loginAs(login: string, password: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7726345678', login, password } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }
    const clinicLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7712345671', login: 'clinicadmin2', password: 'admin2026aa' } });
    const clinicCookie = extractCookie(clinicLogin.headers['set-cookie'], 'k785_session')!;
    await app.inject({ method: 'POST', url: '/api/clinic/stages/9/request-payment', cookies: { k785_session: clinicCookie } });

    const managerCookie = await loginAs('manager2', 'manager2026');
    const confirmAttempt = await app.inject({ method: 'POST', url: '/api/panel/stage-payments/7712345671/9/confirm', cookies: { k785_session: managerCookie } });
    expect(confirmAttempt.statusCode).toBe(200);
    expect(confirmAttempt.json().secondHandRequest).toBeDefined();
    const requestId = confirmAttempt.json().secondHandRequest.id;

    // тот же менеджер не может подтвердить свою же крупную оплату через общий эндпоинт
    const selfConfirm = await app.inject({ method: 'POST', url: `/api/second-hand/${requestId}/confirm`, cookies: { k785_session: managerCookie } });
    expect(selfConfirm.json().ok).toBe(false);

    const headCookie = await loginAs('head1', 'saleshead2026');
    const finalConfirm = await app.inject({ method: 'POST', url: `/api/second-hand/${requestId}/confirm`, cookies: { k785_session: headCookie } });
    expect(finalConfirm.statusCode).toBe(200);
    expect(finalConfirm.json().ok).toBe(true);
  });

  it('годовой цикл → оборудование → сводный отчёт → самообследование → дашборд, полный HTTP-цикл', async () => {
    const methodistReg = await container.auth.register({ inn: '7726345678', login: 'metodist2', password: 'metodist2026', password2: 'metodist2026', fio: 'Николаева Е. В.', side: 'operator', role: 'methodist' });
    const adminReg = await container.auth.register({ inn: '7726345678', login: 'admin2', password: 'platform2026', password2: 'platform2026', fio: 'Admin Two', side: 'operator', role: 'platform_admin' });
    if (!methodistReg.ok || !adminReg.ok) throw new Error('setup failed');
    await repos.accounts.update(methodistReg.account.id, { pending: false });
    await repos.accounts.update(adminReg.account.id, { pending: false });
    const clinicReg = await container.auth.register({ inn: '7712345671', login: 'vkk1', password: 'vkk2026lead', password2: 'vkk2026lead', fio: 'Иванова М. А.', side: 'clinic', role: 'vkk_lead' });
    if (!clinicReg.ok) throw new Error('setup failed');

    async function loginAs(inn: string, login: string, password: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn, login, password } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }
    const methodistCookie = await loginAs('7726345678', 'metodist2', 'metodist2026');
    const adminCookie = await loginAs('7726345678', 'admin2', 'platform2026');
    const clinicCookie = await loginAs('7712345671', 'vkk1', 'vkk2026lead');

    // методист заводит запросы на публикацию годового цикла, каталога чек-листов, типов
    // оборудования и сводного отчёта — каждый ждёт подтверждения ВТОРЫМ сотрудником (standard:publish)
    async function publishAndConfirm(url: string, payload: Record<string, unknown> | unknown[]) {
      const put = await app.inject({ method: 'PUT', url, cookies: { k785_session: methodistCookie }, payload });
      expect(put.statusCode).toBe(200);
      const confirm = await app.inject({ method: 'POST', url: `/api/second-hand/${put.json().secondHandRequest.id}/confirm`, cookies: { k785_session: adminCookie } });
      expect(confirm.statusCode).toBe(200);
    }
    await publishAndConfirm('/api/panel/cycle', { year: 2026, dirs: [{ name: 'Эпидемиологическая безопасность', months: [2] }], capaTerms: [] });
    await publishAndConfirm('/api/panel/checklists', [{ name: 'Чек-лист аудита стерилизационной', items: ['Режимы соблюдаются?', 'Индикаторы вклеены?'] }]);
    await publishAndConfirm('/api/panel/equip-types', [{ key: 'fridge', name: 'Холодильник', logs: [{ name: 'Журнал термометрии', freq: 'ежедневно', kind: 'журнал' }] }]);
    await publishAndConfirm('/api/panel/summary-master', [{ name: 'Сводный отчёт по системе качества за год', note: '', req: true }]);

    // клиника донастраивает направление и генерирует план из цикла
    await app.inject({
      method: 'PUT', url: '/api/clinic/cycle/' + encodeURIComponent('Эпидемиологическая безопасность'), cookies: { k785_session: clinicCookie },
      payload: { check: 'Чек-лист аудита стерилизационной', who: 'Сидорова В. В.' },
    });
    const gen = await app.inject({ method: 'POST', url: '/api/clinic/cycle/generate', cookies: { k785_session: clinicCookie } });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().generated).toBe(1);

    const plan = await app.inject({ method: 'GET', url: '/api/clinic/plan', cookies: { k785_session: clinicCookie } });
    expect(plan.json().plan).toHaveLength(1);
    expect(plan.json().plan[0].date).toBe('01.03.2026');

    // оборудование: клиника заводит позицию и заполняет форму
    const pos = await app.inject({
      method: 'POST', url: '/api/clinic/equipment/positions', cookies: { k785_session: clinicCookie },
      payload: { name: 'Холодильник №1', type: 'fridge', logWho: { 'Журнал термометрии': 'Иванова М. А.' } },
    });
    expect(pos.statusCode).toBe(200);
    const posUid = pos.json().position.uid;
    const fill = await app.inject({
      method: 'POST', url: `/api/clinic/equipment/positions/${posUid}/forms/${encodeURIComponent('Журнал термометрии')}/fill`,
      cookies: { k785_session: clinicCookie }, payload: { value: '+4°C', source: 'кабинет клиники' },
    });
    expect(fill.statusCode).toBe(200);
    const forms = await app.inject({ method: 'GET', url: '/api/clinic/equipment/forms', cookies: { k785_session: clinicCookie } });
    expect(forms.json().forms[0].dueNow).toBe(false);

    // сводный отчёт: клиника загружает файл
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const upload = await app.inject({
      method: 'POST', url: '/api/clinic/summary/' + encodeURIComponent('Сводный отчёт по системе качества за год') + '/upload',
      cookies: { k785_session: clinicCookie }, payload: { fileName: 'отчёт.png', base64: png },
    });
    expect(upload.statusCode).toBe(200);

    // самообследование: одно нарушение автоматически становится мероприятием
    await app.inject({ method: 'POST', url: '/api/clinic/selfaudit/' + encodeURIComponent('Чек-лист аудита стерилизационной') + '/start', cookies: { k785_session: clinicCookie } });
    await app.inject({
      method: 'POST', url: '/api/clinic/selfaudit/' + encodeURIComponent('Чек-лист аудита стерилизационной') + '/answer',
      cookies: { k785_session: clinicCookie }, payload: { index: 0, answer: 'ok' },
    });
    await app.inject({
      method: 'POST', url: '/api/clinic/selfaudit/' + encodeURIComponent('Чек-лист аудита стерилизационной') + '/answer',
      cookies: { k785_session: clinicCookie }, payload: { index: 1, answer: 'bad', comment: 'Индикаторы просрочены' },
    });
    const finish = await app.inject({ method: 'POST', url: '/api/clinic/selfaudit/' + encodeURIComponent('Чек-лист аудита стерилизационной') + '/finish', cookies: { k785_session: clinicCookie } });
    expect(finish.statusCode).toBe(200);
    expect(finish.json().capaCreated).toBe(1);

    const exportRes = await app.inject({ method: 'GET', url: '/api/clinic/selfaudit/export', cookies: { k785_session: clinicCookie } });
    expect(exportRes.statusCode).toBe(200);
    expect(exportRes.body).toContain('НЕ СООТВЕТСТВУЕТ');

    // дашборд платформы видит клинику с правильными счётчиками
    const clients = await app.inject({ method: 'GET', url: '/api/panel/clients', cookies: { k785_session: methodistCookie } });
    expect(clients.statusCode).toBe(200);
    const row = clients.json().clients.find((c: { inn: string }) => c.inn === '7712345671');
    expect(row.openCapa).toBe(1);

    // клиника (side=clinic) не может открыть каталог клиентов — нет clinic:read
    const denied = await app.inject({ method: 'GET', url: '/api/panel/clients', cookies: { k785_session: clinicCookie } });
    expect(denied.statusCode).toBe(403);
  });

  it('выдача документа без оплаты — операция второй руки (doc:grant-without-payment)', async () => {
    const methodistReg = await container.auth.register({ inn: '7726345678', login: 'metodist3', password: 'metodist2026', password2: 'metodist2026', fio: 'Николаева Е. В.', side: 'operator', role: 'methodist' });
    const admin2Reg = await container.auth.register({ inn: '7726345678', login: 'admin3', password: 'platform2026', password2: 'platform2026', fio: 'Admin Three', side: 'operator', role: 'platform_admin' });
    if (!methodistReg.ok || !admin2Reg.ok) throw new Error('setup failed');
    await repos.accounts.update(methodistReg.account.id, { pending: false });
    await repos.accounts.update(admin2Reg.account.id, { pending: false });
    await container.auth.register({ inn: '7712345671', login: 'clinicX', password: 'admin2026aa', password2: 'admin2026aa', fio: 'X', side: 'clinic', role: 'clinic_admin' });

    async function loginAs(login: string, password: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7726345678', login, password } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }
    const methodistCookie = await loginAs('metodist3', 'metodist2026');
    const adminCookie = await loginAs('admin3', 'platform2026');

    const req = await app.inject({
      method: 'POST', url: '/api/documents/grant', cookies: { k785_session: methodistCookie },
      payload: { tenantInn: '7712345671', stage: '1', code: 'DOC-X', name: 'Документ без оплаты', paid: false },
    });
    expect(req.statusCode).toBe(200);
    expect(req.json().secondHandRequest).toBeDefined();
    const requestId = req.json().secondHandRequest.id;

    // документ ещё не выдан — заявка ждёт подтверждения
    const grantsBefore = await app.inject({ method: 'GET', url: '/api/tenants/7712345671/documents/grants', cookies: { k785_session: methodistCookie } });
    expect(grantsBefore.json().grants['DOC-X']).toBeUndefined();

    // автор заявки не может подтвердить сам
    const selfConfirm = await app.inject({ method: 'POST', url: `/api/second-hand/${requestId}/confirm`, cookies: { k785_session: methodistCookie } });
    expect(selfConfirm.json().ok).toBe(false);

    const confirm = await app.inject({ method: 'POST', url: `/api/second-hand/${requestId}/confirm`, cookies: { k785_session: adminCookie } });
    expect(confirm.statusCode).toBe(200);

    // выдающим в записи стал ПОДТВЕРЖДАЮЩИЙ (администратор), а не автор запроса (методист)
    const grantsAfter = await app.inject({ method: 'GET', url: '/api/tenants/7712345671/documents/grants', cookies: { k785_session: methodistCookie } });
    expect(grantsAfter.json().grants['DOC-X']).toMatchObject({ paid: false, byRole: 'platform_admin' });
  });

  it('тарифы: черновик → публикация второй рукой → подписка клиники → продление → удаление тарифа', async () => {
    const managerReg = await container.auth.register({ inn: '7726345678', login: 'manager3', password: 'manager2026', password2: 'manager2026', fio: 'Гусев Р. А.', side: 'operator', role: 'sales_manager' });
    const headReg = await container.auth.register({ inn: '7726345678', login: 'head3', password: 'saleshead2026', password2: 'saleshead2026', fio: 'Лазарева Т. М.', side: 'operator', role: 'sales_head' });
    if (!managerReg.ok || !headReg.ok) throw new Error('setup failed');
    await repos.accounts.update(managerReg.account.id, { pending: false });
    await repos.accounts.update(headReg.account.id, { pending: false });
    await container.auth.register({ inn: '7712345671', login: 'clinicY', password: 'admin2026aa', password2: 'admin2026aa', fio: 'Y', side: 'clinic', role: 'clinic_admin' });

    async function loginAs(login: string, password: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7726345678', login, password } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }
    const managerCookie = await loginAs('manager3', 'manager2026');
    const headCookie = await loginAs('head3', 'saleshead2026');

    const tariff = { key: 'start', name: 'Старт', price: 15000, period: 'monthly' as const, description: '', active: false };
    const draft = await app.inject({ method: 'PUT', url: '/api/panel/tariffs', cookies: { k785_session: managerCookie }, payload: [tariff] });
    expect(draft.statusCode).toBe(200);

    const publishReq = await app.inject({ method: 'POST', url: '/api/panel/tariffs/start/publish', cookies: { k785_session: managerCookie } });
    expect(publishReq.statusCode).toBe(200);
    const publishConfirm = await app.inject({ method: 'POST', url: `/api/second-hand/${publishReq.json().secondHandRequest.id}/confirm`, cookies: { k785_session: headCookie } });
    expect(publishConfirm.statusCode).toBe(200);

    const tariffsList = await app.inject({ method: 'GET', url: '/api/panel/tariffs', cookies: { k785_session: managerCookie } });
    expect(tariffsList.json().tariffs[0]).toMatchObject({ key: 'start', active: true });

    const assign = await app.inject({
      method: 'POST', url: '/api/panel/subscriptions/7712345671/assign', cookies: { k785_session: managerCookie },
      payload: { tariffKey: 'start', days: 30 },
    });
    expect(assign.statusCode).toBe(200);
    expect(assign.json().subscription.status).toBe('active');

    const subs = await app.inject({ method: 'GET', url: '/api/panel/subscriptions', cookies: { k785_session: headCookie } });
    expect(subs.json().subscriptions.find((s: { inn: string }) => s.inn === '7712345671')).toMatchObject({ tariffName: 'Старт', status: 'active' });

    const renew = await app.inject({ method: 'POST', url: '/api/panel/subscriptions/7712345671/renew', cookies: { k785_session: headCookie }, payload: { days: 15 } });
    expect(renew.statusCode).toBe(200);

    const deleteReq = await app.inject({ method: 'POST', url: '/api/panel/tariffs/start/delete', cookies: { k785_session: managerCookie } });
    expect(deleteReq.statusCode).toBe(200);
    const deleteConfirm = await app.inject({ method: 'POST', url: `/api/second-hand/${deleteReq.json().secondHandRequest.id}/confirm`, cookies: { k785_session: headCookie } });
    expect(deleteConfirm.statusCode).toBe(200);
    const tariffsAfterDelete = await app.inject({ method: 'GET', url: '/api/panel/tariffs', cookies: { k785_session: managerCookie } });
    expect(tariffsAfterDelete.json().tariffs).toHaveLength(0);
  });

  it('массовая операция ≤20 клиник применяется сразу и допускает откат', async () => {
    const managerReg = await container.auth.register({ inn: '7726345678', login: 'manager4', password: 'manager2026', password2: 'manager2026', fio: 'Гусев Р. А.', side: 'operator', role: 'sales_manager' });
    const headReg = await container.auth.register({ inn: '7726345678', login: 'head4', password: 'saleshead2026', password2: 'saleshead2026', fio: 'Лазарева Т. М.', side: 'operator', role: 'sales_head' });
    if (!managerReg.ok || !headReg.ok) throw new Error('setup failed');
    await repos.accounts.update(managerReg.account.id, { pending: false });
    await repos.accounts.update(headReg.account.id, { pending: false });
    await container.auth.register({ inn: '7712345671', login: 'clinicZ1', password: 'admin2026aa', password2: 'admin2026aa', fio: 'Z1', side: 'clinic', role: 'clinic_admin' });
    await container.auth.register({ inn: '5001007322', login: 'clinicZ2', password: 'admin2026aa', password2: 'admin2026aa', fio: 'Z2', side: 'clinic', role: 'clinic_admin' });

    async function loginAs(login: string, password: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7726345678', login, password } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }
    const managerCookie = await loginAs('manager4', 'manager2026');
    const headCookie = await loginAs('head4', 'saleshead2026');

    await app.inject({ method: 'PUT', url: '/api/panel/tariffs', cookies: { k785_session: managerCookie }, payload: [{ key: 'pro', name: 'Про', price: 30000, period: 'monthly', description: '', active: false }] });
    const pub = await app.inject({ method: 'POST', url: '/api/panel/tariffs/pro/publish', cookies: { k785_session: managerCookie } });
    await app.inject({ method: 'POST', url: `/api/second-hand/${pub.json().secondHandRequest.id}/confirm`, cookies: { k785_session: headCookie } });
    await app.inject({ method: 'POST', url: '/api/panel/subscriptions/7712345671/assign', cookies: { k785_session: managerCookie }, payload: { tariffKey: 'pro', days: 30 } });
    await app.inject({ method: 'POST', url: '/api/panel/subscriptions/5001007322/assign', cookies: { k785_session: managerCookie }, payload: { tariffKey: 'pro', days: 30 } });

    const prepare = await app.inject({
      method: 'POST', url: '/api/panel/bulk/subscription-extend/prepare', cookies: { k785_session: managerCookie },
      payload: { tenantInns: ['7712345671', '5001007322'] },
    });
    expect(prepare.statusCode).toBe(200);
    expect(prepare.json().rows.every((r: { ok: boolean }) => r.ok)).toBe(true);

    const commit = await app.inject({
      method: 'POST', url: '/api/panel/bulk/subscription-extend/commit', cookies: { k785_session: managerCookie },
      payload: { tenantInns: ['7712345671', '5001007322'] },
    });
    expect(commit.statusCode).toBe(200);
    const report = commit.json().report;
    expect(report.done).toHaveLength(2);
    expect(report.undoable).toBe(true);

    const subsAfter = await app.inject({ method: 'GET', url: '/api/panel/subscriptions', cookies: { k785_session: headCookie } });
    const row1 = subsAfter.json().subscriptions.find((s: { inn: string }) => s.inn === '7712345671');
    expect(row1.expiresAt).not.toBe(null);

    const reportsList = await app.inject({ method: 'GET', url: '/api/panel/bulk/reports', cookies: { k785_session: headCookie } });
    expect(reportsList.json().reports[0].id).toBe(report.id);

    const undo = await app.inject({ method: 'POST', url: `/api/panel/bulk/reports/${report.id}/undo`, cookies: { k785_session: headCookie } });
    expect(undo.statusCode).toBe(200);
    // повторный откат отклоняется
    const undoAgain = await app.inject({ method: 'POST', url: `/api/panel/bulk/reports/${report.id}/undo`, cookies: { k785_session: headCookie } });
    expect(undoAgain.json().ok).toBe(false);
  });

  it('массовая операция больше 20 клиник (методологическая) уходит через вторую руку с правом second:standard', async () => {
    const methodistReg = await container.auth.register({ inn: '7726345678', login: 'metodist4', password: 'metodist2026', password2: 'metodist2026', fio: 'Николаева Е. В.', side: 'operator', role: 'methodist' });
    const adminReg = await container.auth.register({ inn: '7726345678', login: 'admin4', password: 'platform2026', password2: 'platform2026', fio: 'Admin Four', side: 'operator', role: 'platform_admin' });
    const managerReg = await container.auth.register({ inn: '7726345678', login: 'manager5', password: 'manager2026', password2: 'manager2026', fio: 'Гусев Р. А.', side: 'operator', role: 'sales_manager' });
    if (!methodistReg.ok || !adminReg.ok || !managerReg.ok) throw new Error('setup failed');
    await repos.accounts.update(methodistReg.account.id, { pending: false });
    await repos.accounts.update(adminReg.account.id, { pending: false });
    await repos.accounts.update(managerReg.account.id, { pending: false });

    async function loginAs(login: string, password: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7726345678', login, password } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }
    const methodistCookie = await loginAs('metodist4', 'metodist2026');
    const adminCookie = await loginAs('admin4', 'platform2026');
    const managerCookie = await loginAs('manager5', 'manager2026');

    const cyclePut = await app.inject({
      method: 'PUT', url: '/api/panel/cycle', cookies: { k785_session: methodistCookie },
      payload: { year: 2026, dirs: [{ name: 'Направление А', months: [0] }], capaTerms: [] },
    });
    await app.inject({ method: 'POST', url: `/api/second-hand/${cyclePut.json().secondHandRequest.id}/confirm`, cookies: { k785_session: adminCookie } });

    const many = Array.from({ length: 21 }, (_, i) => `bulk-inn-${i}`);
    const commit = await app.inject({
      method: 'POST', url: '/api/panel/bulk/cycle-bulk-apply/commit', cookies: { k785_session: methodistCookie },
      payload: { tenantInns: many },
    });
    expect(commit.statusCode).toBe(200);
    expect(commit.json().secondHandRequest).toBeDefined();
    const requestId = commit.json().secondHandRequest.id;

    // менеджер по продажам не подтверждает методологическую пачку (нет second:standard)
    const managerConfirm = await app.inject({ method: 'POST', url: `/api/second-hand/${requestId}/confirm`, cookies: { k785_session: managerCookie } });
    expect(managerConfirm.statusCode).toBe(403);

    const confirm = await app.inject({ method: 'POST', url: `/api/second-hand/${requestId}/confirm`, cookies: { k785_session: adminCookie } });
    expect(confirm.statusCode).toBe(200);

    const cycleLive = await repos.channels.get('tenant', 'bulk-inn-0', 'cycle_live', null);
    expect(cycleLive.data).toMatchObject({ dirs: [{ name: 'Направление А', months: [0] }] });
  });

  it('панель: добавление клиники, очередь работы, портфель, сводка подписок и CSV-экспорт', async () => {
    const managerReg = await container.auth.register({ inn: '7726345678', login: 'manager6', password: 'manager2026', password2: 'manager2026', fio: 'Гусев Р. А.', side: 'operator', role: 'sales_manager' });
    const methodistReg = await container.auth.register({ inn: '7726345678', login: 'metodist5', password: 'metodist2026', password2: 'metodist2026', fio: 'Николаева Е. В.', side: 'operator', role: 'methodist' });
    if (!managerReg.ok || !methodistReg.ok) throw new Error('setup failed');
    await repos.accounts.update(managerReg.account.id, { pending: false });
    await repos.accounts.update(methodistReg.account.id, { pending: false });

    async function loginAs(login: string, password: string) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7726345678', login, password } });
      return extractCookie(res.headers['set-cookie'], 'k785_session')!;
    }
    const managerCookie = await loginAs('manager6', 'manager2026');
    const methodistCookie = await loginAs('metodist5', 'metodist2026');

    // методист не может добавить клинику (нет sub:write)
    const deniedAdd = await app.inject({
      method: 'POST', url: '/api/panel/clients', cookies: { k785_session: methodistCookie },
      payload: { inn: '7719000010', org: 'ООО «Новая клиника»', login: 'newclinic', password: 'newclinic2026', password2: 'newclinic2026', fio: 'Директор Д. Д.' },
    });
    expect(deniedAdd.statusCode).toBe(403);

    // менеджер добавляет клинику напрямую из панели
    const add = await app.inject({
      method: 'POST', url: '/api/panel/clients', cookies: { k785_session: managerCookie },
      payload: { inn: '7719000010', org: 'ООО «Новая клиника»', login: 'newclinic', password: 'newclinic2026', password2: 'newclinic2026', fio: 'Директор Д. Д.' },
    });
    expect(add.statusCode).toBe(200);

    // новая клиника без единого обхода — сразу видна в очереди работы
    const queue = await app.inject({ method: 'GET', url: '/api/panel/queue', cookies: { k785_session: methodistCookie } });
    expect(queue.statusCode).toBe(200);
    const task = queue.json().tasks.find((t: { tenantInn: string }) => t.tenantInn === '7719000010');
    expect(task).toMatchObject({ title: 'Клиника без единого обхода', state: 'new' });

    // методист берёт задачу в работу
    const take = await app.inject({ method: 'POST', url: `/api/panel/queue/${task.id}/take`, cookies: { k785_session: methodistCookie } });
    expect(take.statusCode).toBe(200);
    const afterTake = await app.inject({ method: 'GET', url: '/api/panel/queue', cookies: { k785_session: managerCookie } });
    expect(afterTake.json().tasks.find((t: { id: string }) => t.id === task.id)).toMatchObject({ state: 'in_progress' });

    // настройка и отправка дайджеста
    const saveDigest = await app.inject({
      method: 'PUT', url: '/api/panel/queue/digest-settings', cookies: { k785_session: methodistCookie },
      payload: { recipientEmail: 'ops@standart-kachestva.ru', schedule: 'каждое утро, 09:00' },
    });
    expect(saveDigest.statusCode).toBe(200);
    const sendDigest = await app.inject({ method: 'POST', url: '/api/panel/queue/digest/send', cookies: { k785_session: methodistCookie } });
    expect(sendDigest.statusCode).toBe(200);
    expect(sendDigest.json().taskCount).toBeGreaterThan(0);

    // портфель дашборда считает добавленную клинику
    const portfolio = await app.inject({ method: 'GET', url: '/api/panel/portfolio?days=30', cookies: { k785_session: methodistCookie } });
    expect(portfolio.statusCode).toBe(200);
    expect(portfolio.json().portfolio.clinicsCount).toBeGreaterThanOrEqual(1);

    // сводка подписок и CSV-экспорт каталога клиентов
    const subsSummary = await app.inject({ method: 'GET', url: '/api/panel/subscriptions/summary', cookies: { k785_session: managerCookie } });
    expect(subsSummary.statusCode).toBe(200);

    const csv = await app.inject({ method: 'GET', url: '/api/panel/clients/export', cookies: { k785_session: managerCookie } });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Новая клиника');
  });

  it('logout отзывает cookie сессии — повторный запрос получает 401', async () => {
    await container.auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic' });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7712345671', login: 'medplus', password: 'medplus2026' } });
    const sessionCookie = extractCookie(login.headers['set-cookie'], 'k785_session')!;
    await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { k785_session: sessionCookie } });
    const after = await app.inject({ method: 'GET', url: '/api/executor/overview', cookies: { k785_session: sessionCookie } });
    expect(after.statusCode).toBe(401);
  });
});
