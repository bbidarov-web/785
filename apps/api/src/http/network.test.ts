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

const HEAD = '7712345671';
const MEMBER = '5001007322';
const OUTSIDER = '5044002348';

/**
 * HTTP-слой сетей клиник (routes/admin.ts, routes/clinic.ts) поверх NetworkService
 * (уже покрыт юнит-тестами в network/service.test.ts) — здесь проверяем маршрутизацию,
 * коды ответов и то, что права проверяются на самом эндпоинте, а не только в сервисе.
 */
describe('HTTP: сети клиник и собственный стандарт сети', () => {
  let app: FastifyInstance;
  let container: Container;
  let repos: ReturnType<typeof createMemoryRepos>;

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
    };
    await reg('7726345678', 'padmin', 'operator', 'platform_admin');
    await reg(HEAD, 'headadmin', 'clinic', 'clinic_admin');
    await reg(MEMBER, 'memberadmin', 'clinic', 'clinic_admin');
    await reg(OUTSIDER, 'outsider', 'clinic', 'clinic_admin');
    await repos.channels.set('platform', null, 'checklists', [{ name: 'Эталонный ЧЛ', items: ['А'] }], { updatedBy: null });
  });

  it('без авторизации все эндпоинты сети закрыты (401)', async () => {
    for (const req of [
      { method: 'GET' as const, url: '/api/admin/networks' },
      { method: 'POST' as const, url: '/api/admin/networks' },
      { method: 'GET' as const, url: '/api/clinic/network' },
      { method: 'PUT' as const, url: '/api/clinic/network/checklists' },
    ]) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(401);
    }
  });

  it('обычная клиника (не платформенный админ) получает 403 на управление сетями', async () => {
    const cookie = await login(HEAD, 'headadmin');
    const res = await app.inject({ method: 'POST', url: '/api/admin/networks', payload: { name: 'X', headInn: HEAD }, cookies: { k785_session: cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('администратор платформы создаёт сеть и добавляет участницу; ответ содержит имена клиник', async () => {
    const adminCookie = await login('7726345678', 'padmin');
    const create = await app.inject({ method: 'POST', url: '/api/admin/networks', payload: { name: 'Сеть «Здоровье»', headInn: HEAD }, cookies: { k785_session: adminCookie } });
    expect(create.statusCode).toBe(200);
    const { id } = create.json();
    expect(id).toBeTruthy();

    const add = await app.inject({ method: 'POST', url: `/api/admin/networks/${id}/members`, payload: { inn: MEMBER }, cookies: { k785_session: adminCookie } });
    expect(add.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/admin/networks', cookies: { k785_session: adminCookie } });
    expect(list.statusCode).toBe(200);
    const net = list.json().networks[0];
    expect(net.members.map((m: { inn: string }) => m.inn).sort()).toEqual([HEAD, MEMBER].sort());
    expect(net.members.find((m: { name: string }) => m.name.includes(HEAD))).toBeTruthy();
  });

  it('несуществующий ИНН и повторное добавление отклоняются с кодом 400 и понятной ошибкой', async () => {
    const adminCookie = await login('7726345678', 'padmin');
    const create = await app.inject({ method: 'POST', url: '/api/admin/networks', payload: { name: 'Сеть', headInn: HEAD }, cookies: { k785_session: adminCookie } });
    const { id } = create.json();

    const badInn = await app.inject({ method: 'POST', url: `/api/admin/networks/${id}/members`, payload: { inn: '1234567890' }, cookies: { k785_session: adminCookie } });
    expect(badInn.statusCode).toBe(400);
    expect(badInn.json().error).toMatch(/не зарегистрирована/);

    const dup = await app.inject({ method: 'POST', url: `/api/admin/networks/${id}/members`, payload: { inn: HEAD }, cookies: { k785_session: adminCookie } });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error).toMatch(/уже входит/);
  });

  it('удаление участницы и удаление сети целиком работают через HTTP', async () => {
    const adminCookie = await login('7726345678', 'padmin');
    const create = await app.inject({ method: 'POST', url: '/api/admin/networks', payload: { name: 'Сеть', headInn: HEAD }, cookies: { k785_session: adminCookie } });
    const { id } = create.json();
    await app.inject({ method: 'POST', url: `/api/admin/networks/${id}/members`, payload: { inn: MEMBER }, cookies: { k785_session: adminCookie } });

    const removeMember = await app.inject({ method: 'DELETE', url: `/api/admin/networks/${id}/members/${MEMBER}`, cookies: { k785_session: adminCookie } });
    expect(removeMember.statusCode).toBe(200);

    const removeHead = await app.inject({ method: 'DELETE', url: `/api/admin/networks/${id}/members/${HEAD}`, cookies: { k785_session: adminCookie } });
    expect(removeHead.statusCode).toBe(400); // головную нельзя убрать — только удалить сеть целиком

    const remove = await app.inject({ method: 'DELETE', url: `/api/admin/networks/${id}`, cookies: { k785_session: adminCookie } });
    expect(remove.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/admin/networks', cookies: { k785_session: adminCookie } });
    expect(list.json().networks).toEqual([]);
  });

  async function createNetworkWithMember(): Promise<string> {
    const adminCookie = await login('7726345678', 'padmin');
    const create = await app.inject({ method: 'POST', url: '/api/admin/networks', payload: { name: 'Сеть', headInn: HEAD }, cookies: { k785_session: adminCookie } });
    const { id } = create.json();
    await app.inject({ method: 'POST', url: `/api/admin/networks/${id}/members`, payload: { inn: MEMBER }, cookies: { k785_session: adminCookie } });
    return id;
  }

  it('клиника вне сети получает network: null через GET /api/clinic/network', async () => {
    await createNetworkWithMember();
    const outsiderCookie = await login(OUTSIDER, 'outsider');
    const res = await app.inject({ method: 'GET', url: '/api/clinic/network', cookies: { k785_session: outsiderCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().network).toBeNull();
  });

  it('головная клиника сохраняет чек-лист сети через PUT; он приходит в GET и попадает в эталон участницы', async () => {
    await createNetworkWithMember();
    const headCookie = await login(HEAD, 'headadmin');

    const save = await app.inject({
      method: 'PUT', url: '/api/clinic/network/checklists',
      payload: { checklists: [{ name: 'ЧЛ сети', items: ['Пункт 1', 'Пункт 2'] }] },
      cookies: { k785_session: headCookie },
    });
    expect(save.statusCode).toBe(200);

    const headView = await app.inject({ method: 'GET', url: '/api/clinic/network', cookies: { k785_session: headCookie } });
    const body = headView.json().network;
    expect(body.isHead).toBe(true);
    expect(body.overlay.checklists).toEqual([{ name: 'ЧЛ сети', items: ['Пункт 1', 'Пункт 2'] }]);
    expect(body.members.map((m: { inn: string }) => m.inn).sort()).toEqual([HEAD, MEMBER].sort());

    const catalog = await new (await import('../standard/editions.js')).StandardEditionService(repos).catalog<{ name: string }[]>(MEMBER, 'checklists', []);
    expect(catalog.map((c) => c.name)).toEqual(['Эталонный ЧЛ', 'ЧЛ сети']);
  });

  it('название, совпадающее с эталонным чек-листом, отклоняется с 400', async () => {
    await createNetworkWithMember();
    const headCookie = await login(HEAD, 'headadmin');
    const res = await app.inject({
      method: 'PUT', url: '/api/clinic/network/checklists',
      payload: { checklists: [{ name: 'эталонный чл', items: ['А'] }] },
      cookies: { k785_session: headCookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/совпадает с эталонным/);
  });

  it('участница сети видит состав как null и получает 403 при попытке править чек-листы через API', async () => {
    await createNetworkWithMember();
    const headCookie = await login(HEAD, 'headadmin');
    await app.inject({ method: 'PUT', url: '/api/clinic/network/checklists', payload: { checklists: [{ name: 'ЧЛ сети', items: ['А'] }] }, cookies: { k785_session: headCookie } });

    const memberCookie = await login(MEMBER, 'memberadmin');
    const view = await app.inject({ method: 'GET', url: '/api/clinic/network', cookies: { k785_session: memberCookie } });
    const body = view.json().network;
    expect(body.isHead).toBe(false);
    expect(body.members).toBeNull();
    expect(body.overlay.checklists).toEqual([{ name: 'ЧЛ сети', items: ['А'] }]);

    const edit = await app.inject({ method: 'PUT', url: '/api/clinic/network/checklists', payload: { checklists: [] }, cookies: { k785_session: memberCookie } });
    expect(edit.statusCode).toBe(403);
  });

  it('клиника вне сети получает 403 на PUT /api/clinic/network/checklists', async () => {
    await createNetworkWithMember();
    const outsiderCookie = await login(OUTSIDER, 'outsider');
    const res = await app.inject({ method: 'PUT', url: '/api/clinic/network/checklists', payload: { checklists: [{ name: 'X', items: ['1'] }] }, cookies: { k785_session: outsiderCookie } });
    expect(res.statusCode).toBe(403);
  });
});
