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

const PLATFORM_INN = '7726345678';
const CLINIC_A = '7712345671';
const CLINIC_B = '5001007322';

/**
 * HTTP-слой «ответственного менеджера» (routes/admin.ts manager-assignments, routes/documents.ts
 * grant/revoke) поверх ManagerAssignmentService, который уже покрыт юнит-тестами
 * (panel/managerAssignments.test.ts) — здесь проверяем маршрутизацию и коды ответов.
 */
describe('HTTP: «ответственный менеджер» — закрепление и его действие на выдачу документов', () => {
  let app: FastifyInstance;
  let container: Container;
  let repos: ReturnType<typeof createMemoryRepos>;
  let managerId: string;

  async function login(inn: string, loginName: string, password = 'Passw0rd2026'): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { inn, login: loginName, password } });
    const cookie = extractCookie(res.headers['set-cookie'], 'k785_session');
    if (!cookie) throw new Error('login failed: ' + res.body);
    return cookie;
  }

  beforeEach(async () => {
    repos = createMemoryRepos();
    container = buildContainerFromRepos(repos);
    app = await buildApp(container, { cookieSecret: 'x'.repeat(32), corsOrigin: 'http://localhost:3000', logger: false });
    await app.ready();

    const reg = async (inn: string, loginName: string, side: 'clinic' | 'operator', role: string) => {
      const r = await container.auth.register({ inn, login: loginName, password: 'Passw0rd2026', password2: 'Passw0rd2026', fio: loginName, org: 'Клиника ' + inn, side, role: role as never });
      if (!r.ok) throw new Error(r.error);
      await repos.accounts.update(r.account.id, { pending: false });
      return r.account.id;
    };
    await reg(PLATFORM_INN, 'padmin', 'operator', 'platform_admin');
    managerId = await reg(PLATFORM_INN, 'manager1', 'operator', 'sales_manager');
    await reg(PLATFORM_INN, 'head1', 'operator', 'sales_head');
    await reg(CLINIC_A, 'clinicadmin', 'clinic', 'clinic_admin');
    await reg(CLINIC_B, 'clinicb', 'clinic', 'clinic_admin');
  });

  it('без авторизации закрыто; менеджеру и руководителю продаж (не admin) — 403', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/admin/manager-assignments' });
    expect(list.statusCode).toBe(401);

    const managerCookie = await login(PLATFORM_INN, 'manager1');
    const forbidden = await app.inject({ method: 'GET', url: '/api/admin/manager-assignments', cookies: { k785_session: managerCookie } });
    expect(forbidden.statusCode).toBe(403);

    const headCookie = await login(PLATFORM_INN, 'head1');
    const forbiddenHead = await app.inject({ method: 'PUT', url: `/api/admin/manager-assignments/${managerId}`, payload: { inns: [CLINIC_A] }, cookies: { k785_session: headCookie } });
    expect(forbiddenHead.statusCode).toBe(403);
  });

  it('администратор закрепляет менеджера за клиникой; список отражает это', async () => {
    const adminCookie = await login(PLATFORM_INN, 'padmin');
    const put = await app.inject({ method: 'PUT', url: `/api/admin/manager-assignments/${managerId}`, payload: { inns: [CLINIC_A] }, cookies: { k785_session: adminCookie } });
    expect(put.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/admin/manager-assignments', cookies: { k785_session: adminCookie } });
    expect(list.statusCode).toBe(200);
    const row = list.json().assignments[0];
    expect(row.clinics).toEqual([{ inn: CLINIC_A, name: 'Клиника ' + CLINIC_A }]);
  });

  it('без закрепления менеджер видит обе клиники в каталоге; после закрепления — только свою', async () => {
    const managerCookie = await login(PLATFORM_INN, 'manager1');
    const before = await app.inject({ method: 'GET', url: '/api/panel/clients', cookies: { k785_session: managerCookie } });
    expect(before.json().clients).toHaveLength(2);

    const adminCookie = await login(PLATFORM_INN, 'padmin');
    await app.inject({ method: 'PUT', url: `/api/admin/manager-assignments/${managerId}`, payload: { inns: [CLINIC_A] }, cookies: { k785_session: adminCookie } });

    const after = await app.inject({ method: 'GET', url: '/api/panel/clients', cookies: { k785_session: managerCookie } });
    expect(after.json().clients.map((c: { inn: string }) => c.inn)).toEqual([CLINIC_A]);
  });

  it('закреплённый менеджер не может выдать документ чужой клинике, но может — своей', async () => {
    const adminCookie = await login(PLATFORM_INN, 'padmin');
    await app.inject({ method: 'PUT', url: `/api/admin/manager-assignments/${managerId}`, payload: { inns: [CLINIC_A] }, cookies: { k785_session: adminCookie } });
    const managerCookie = await login(PLATFORM_INN, 'manager1');

    const denied = await app.inject({
      method: 'POST', url: '/api/documents/grant',
      payload: { tenantInn: CLINIC_B, stage: '1', code: 'doc1', name: 'Документ', paid: true },
      cookies: { k785_session: managerCookie },
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'POST', url: '/api/documents/grant',
      payload: { tenantInn: CLINIC_A, stage: '1', code: 'doc1', name: 'Документ', paid: true },
      cookies: { k785_session: managerCookie },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('руководителю продаж закрепление менеджера не сужает его собственный обзор', async () => {
    const adminCookie = await login(PLATFORM_INN, 'padmin');
    await app.inject({ method: 'PUT', url: `/api/admin/manager-assignments/${managerId}`, payload: { inns: [CLINIC_A] }, cookies: { k785_session: adminCookie } });

    const headCookie = await login(PLATFORM_INN, 'head1');
    const clients = await app.inject({ method: 'GET', url: '/api/panel/clients', cookies: { k785_session: headCookie } });
    expect(clients.json().clients).toHaveLength(2);
    const grant = await app.inject({
      method: 'POST', url: '/api/documents/grant',
      payload: { tenantInn: CLINIC_B, stage: '1', code: 'doc1', name: 'Документ', paid: true },
      cookies: { k785_session: headCookie },
    });
    expect(grant.statusCode).toBe(200);
  });
});
