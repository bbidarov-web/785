import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { CapaService } from './capaService.js';
import { WalkService } from '../walk/service.js';
import type { Account } from '../domain/types.js';
import type { WalkResultEntry } from '../shared/channelShapes.js';

const inn = '7712345671';

function makeAccount(role: Account['role'], fio: string, branchName: string | null = null): Account {
  return {
    id: 'acc_' + role + (branchName ?? ''), inn, login: role, phone: null, email: null, org: null,
    fio, side: 'clinic', role, pending: false, requestedRole: null, branchName,
    passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}

const walk = (planId: string, branch: string, actNo: string): WalkResultEntry => ({
  planId, walkId: planId, name: 'Аудит ' + branch, object: 'Кабинет', branch, kind: 'плановая', who: 'Сидорова В. В.',
  finished: true, answered: 1, total: 1, bad: 1, date: '01.03.2026', actNo, source: 'мобильный обход',
  items: [{ text: 'Нарушение в ' + branch, answer: 'bad', comment: '', photoFileId: null }],
});

describe('Изоляция находок, CAPA и актов по филиалам', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let capa: CapaService;
  let walks: WalkService;
  const all = makeAccount('vkk_lead', 'Иванова М. А.');
  const north = makeAccount('vkk_lead', 'Северова Н. Н.', 'Север');
  const legacy = { ...walk('p3', '', 'А-2026-003'), branch: undefined };

  beforeEach(async () => {
    repos = createMemoryRepos();
    capa = new CapaService(repos);
    walks = new WalkService(repos);
    await repos.channels.set('tenant', inn, 'walk_results', {
      p1: walk('p1', 'Север', 'А-2026-001'),
      p2: walk('p2', 'Юг', 'А-2026-002'),
      p3: legacy,
    }, { updatedBy: null });
  });

  it('сотрудник филиала видит находки своего филиала и общеклинические, без чужих', async () => {
    const texts = (await capa.listOpenFindings(north)).map((f) => f.text).sort();
    expect(texts).toEqual(['Нарушение в ', 'Нарушение в Север']);
    expect((await capa.listOpenFindings(all))).toHaveLength(3); // без закрепления — все
  });

  it('чужую находку нельзя превратить в CAPA — как будто её нет', async () => {
    const r = await capa.createFromFinding(north, 'p2', 0, { due: '15.03.2026' });
    expect(r).toEqual({ ok: false, error: 'Проверка не найдена' });
    expect((await capa.createFromFinding(north, 'p1', 0, { due: '15.03.2026' })).ok).toBe(true);
  });

  it('мероприятие несёт филиал обхода; список CAPA фильтруется, а правка чужого — «не найдено»', async () => {
    const south = await capa.createFromFinding(all, 'p2', 0, { due: '15.03.2026' });
    const northItem = await capa.createFromFinding(all, 'p1', 0, { due: '15.03.2026' });
    if (!south.ok || !northItem.ok) throw new Error('setup');
    expect(south.item.branch).toBe('Юг');
    expect((await capa.list(north)).map((c) => c.id)).toEqual([northItem.item.id]);
    expect(await capa.updateStatus(north, south.item.id, 'done')).toEqual({ ok: false, error: 'Мероприятие не найдено' });
    expect(await capa.checkEffectiveness(north, south.item.id, true, '')).toEqual({ ok: false, error: 'Мероприятие не найдено' });
    expect((await capa.updateStatus(north, northItem.item.id, 'done')).ok).toBe(true);
    expect(await capa.list(all)).toHaveLength(2);
  });

  it('самообследование общеклиническое — видно сотруднику любого филиала', async () => {
    const r = await capa.createFromSelfAudit(all, 'ЧЛ', 0, 'Пункт', '');
    expect(r.ok).toBe(true);
    expect(await capa.list(north)).toHaveLength(1);
  });

  it('реестр актов и текст акта скрывают чужой филиал', async () => {
    expect((await walks.listActs(north)).map((a) => a.actNo).sort()).toEqual(['А-2026-001', 'А-2026-003']);
    expect((await walks.getActText(north, 'p2')).ok).toBe(false);
    expect((await walks.getActText(north, 'p1')).ok).toBe(true);
    expect(await walks.listActs(all)).toHaveLength(3);
  });
});
