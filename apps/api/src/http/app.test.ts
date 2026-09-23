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

  it('logout отзывает cookie сессии — повторный запрос получает 401', async () => {
    await container.auth.register({ inn: '7712345671', login: 'medplus', password: 'medplus2026', password2: 'medplus2026', fio: 'x', side: 'clinic' });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn: '7712345671', login: 'medplus', password: 'medplus2026' } });
    const sessionCookie = extractCookie(login.headers['set-cookie'], 'k785_session')!;
    await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { k785_session: sessionCookie } });
    const after = await app.inject({ method: 'GET', url: '/api/executor/overview', cookies: { k785_session: sessionCookie } });
    expect(after.statusCode).toBe(401);
  });
});
