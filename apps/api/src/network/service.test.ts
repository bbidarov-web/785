import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { AuthService } from '../auth/service.js';
import { NetworkService } from './service.js';
import { SelfAuditService } from '../clinic/selfAuditService.js';
import { CapaService } from '../clinic/capaService.js';
import { StandardEditionService } from '../standard/editions.js';
import type { Account } from '../domain/types.js';

const HEAD = '7712345671';
const MEMBER = '5001007322';
const OUTSIDER = '7726345678'; // валидный ИНН, но не в сети

describe('Собственный стандарт сети поверх эталона', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let net: NetworkService;
  let admin: Account;
  let headAdmin: Account;
  let memberAdmin: Account;
  let outsiderAdmin: Account;
  let netId: string;

  const reg = async (inn: string, login: string, side: 'clinic' | 'operator', role: string) => {
    const r = await new AuthService(repos).register({ inn, login, password: 'Passw0rd2026', password2: 'Passw0rd2026', fio: login, org: 'Клиника ' + inn, side, role: role as never });
    if (!r.ok) throw new Error(r.error);
    return repos.accounts.update(r.account.id, { pending: false });
  };

  const publishMaster = (list: unknown) => repos.channels.set('platform', null, 'checklists', list, { updatedBy: null });
  const namesFor = async (inn: string) => (await new StandardEditionService(repos).catalog<{ name: string }[]>(inn, 'checklists', [])).map((c) => c.name);

  beforeEach(async () => {
    repos = createMemoryRepos();
    net = new NetworkService(repos);
    admin = await reg('7726345678', 'padmin', 'operator', 'platform_admin');
    headAdmin = await reg(HEAD, 'headadmin', 'clinic', 'clinic_admin');
    memberAdmin = await reg(MEMBER, 'memberadmin', 'clinic', 'clinic_admin');
    outsiderAdmin = await reg('5044002348', 'outsider', 'clinic', 'clinic_admin');
    await publishMaster([{ name: 'Эталонный ЧЛ', items: ['А'] }]);
    const r = await net.create(admin, 'Сеть «Здоровье»', HEAD);
    if (!r.ok) throw new Error(r.error);
    netId = r.id;
    expect((await net.addMember(admin, netId, MEMBER)).ok).toBe(true);
  });

  it('чек-листы сети попадают к головной и участнице, но не к чужой клинике', async () => {
    const set = await net.setChecklists(headAdmin, [{ name: 'Сетевой ЧЛ', items: ['Пункт 1', 'Пункт 2'] }]);
    expect(set.ok).toBe(true);
    expect(await namesFor(HEAD)).toEqual(['Эталонный ЧЛ', 'Сетевой ЧЛ']);
    expect(await namesFor(MEMBER)).toEqual(['Эталонный ЧЛ', 'Сетевой ЧЛ']);
    expect(await namesFor('5044002348')).toEqual(['Эталонный ЧЛ']);
    expect(outsiderAdmin.inn).toBe('5044002348');
  });

  it('сетевой чек-лист работает в самообследовании участницы; методист слой сети не видит', async () => {
    await net.setChecklists(headAdmin, [{ name: 'Сетевой ЧЛ', items: ['Пункт 1'] }]);
    const capa = new CapaService(repos);
    const audit = new SelfAuditService(repos, capa);
    const run = await audit.start(memberAdmin, 'Сетевой ЧЛ');
    expect(run.ok && run.run.items.map((i) => i.text)).toEqual(['Пункт 1']);
    expect((await audit.start(outsiderAdmin, 'Сетевой ЧЛ')).ok).toBe(false);
    const master = (await repos.channels.get<{ name: string }[]>('platform', null, 'checklists', [])).data;
    expect(master.map((c) => c.name)).toEqual(['Эталонный ЧЛ']);
  });

  it('участница сети не может менять слой сети; чужая клиника — тем более', async () => {
    await expect(net.setChecklists(memberAdmin, [{ name: 'X', items: ['1'] }])).rejects.toThrow();
    await expect(net.setChecklists(outsiderAdmin, [{ name: 'X', items: ['1'] }])).rejects.toThrow();
    expect(await namesFor(MEMBER)).toEqual(['Эталонный ЧЛ']);
  });

  it('сетевой чек-лист не может носить название эталонного; повторы и пустое отклоняются', async () => {
    expect((await net.setChecklists(headAdmin, [{ name: '  эталонный чл ', items: ['1'] }])).ok).toBe(false);
    expect((await net.setChecklists(headAdmin, [{ name: 'A', items: ['1'] }, { name: 'a', items: ['2'] }])).ok).toBe(false);
    expect((await net.setChecklists(headAdmin, [{ name: 'A', items: ['  '] }])).ok).toBe(false);
    expect((await net.setChecklists(headAdmin, [{ name: '', items: ['1'] }])).ok).toBe(false);
  });

  it('если методист позже выпустил одноимённый чек-лист — эталон главнее, сетевой скрыт и помечен', async () => {
    await net.setChecklists(headAdmin, [{ name: 'Новый ЧЛ', items: ['1'] }]);
    await publishMaster([{ name: 'Эталонный ЧЛ', items: ['А'] }, { name: 'Новый ЧЛ', items: ['эталон'] }]);
    const list = await new StandardEditionService(repos).catalog<{ name: string; items: string[] }[]>(MEMBER, 'checklists', []);
    expect(list.filter((c) => c.name === 'Новый ЧЛ')).toEqual([{ name: 'Новый ЧЛ', items: ['эталон'] }]);
    expect((await net.mine(headAdmin))?.shadowed).toEqual(['Новый ЧЛ']);
  });

  it('удаление участницы из сети снимает с неё сетевые чек-листы; головную убрать нельзя', async () => {
    await net.setChecklists(headAdmin, [{ name: 'Сетевой ЧЛ', items: ['1'] }]);
    expect((await net.removeMember(admin, netId, HEAD)).ok).toBe(false);
    expect((await net.removeMember(admin, netId, MEMBER)).ok).toBe(true);
    expect(await namesFor(MEMBER)).toEqual(['Эталонный ЧЛ']);
    expect(await namesFor(HEAD)).toContain('Сетевой ЧЛ');
  });

  it('управлять сетями может только администратор платформы; клиника состоит не более чем в одной сети', async () => {
    await expect(net.create(headAdmin, 'Самозванец', OUTSIDER)).rejects.toThrow();
    await expect(net.addMember(headAdmin, netId, '5044002348')).rejects.toThrow();
    await expect(net.listAll(headAdmin)).rejects.toThrow();
    expect((await net.create(admin, 'Вторая', MEMBER)).ok).toBe(false);
    expect((await net.addMember(admin, netId, MEMBER)).ok).toBe(false);
    expect((await net.create(admin, 'Без клиники', '1234567890')).ok).toBe(false);
  });

  it('состав сети видит только головная клиника; участнице — лишь их число', async () => {
    const head = await net.mine(headAdmin);
    expect(head?.isHead).toBe(true);
    expect(head?.members?.map((m) => m.inn).sort()).toEqual([MEMBER, HEAD].sort());
    const member = await net.mine(memberAdmin);
    expect(member?.isHead).toBe(false);
    expect(member?.members).toBeNull();
    expect(member?.network.memberCount).toBe(2);
    expect(await net.mine(outsiderAdmin)).toBeNull();
  });
});
