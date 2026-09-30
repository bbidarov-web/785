import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { StandardEditionService } from './editions.js';
import { StageService } from '../clinic/stageService.js';
import type { Account } from '../domain/types.js';
import type { ChecklistDef, Stage } from '../shared/channelShapes.js';
import { addDays, todayString } from '../shared/date.js';

function acc(role: Account['role'], inn: string, side: Account['side'] = 'clinic'): Account {
  return {
    id: `acc_${role}_${inn}`, inn, login: role, phone: null, email: null, org: null, fio: role, side, role, pending: false,
    requestedRole: null, branchName: null, passwordHash: 'h', twoFactor: false, twoFactorVia: 'sms', blocked: false, mustChange: false,
    createdAt: new Date(), lastLoginAt: null, approvedById: null, approvedAt: null, passwordChangedAt: null,
  };
}
const A = '7712345671';
const B = '5001007322';
const cl = (name: string, ...items: string[]): ChecklistDef => ({ name, items });

describe('StandardEditionService — редакции стандарта и принятие клиникой', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: StandardEditionService;
  const admin = acc('clinic_admin', A);
  const adminB = acc('clinic_admin', B);
  const auditor = acc('auditor', A);
  const methodist = acc('methodist', '7726345678', 'platform');

  beforeEach(async () => {
    repos = createMemoryRepos();
    svc = new StandardEditionService(repos);
    await repos.tenants.upsert(A, 'Клиника А');
    await repos.tenants.upsert(B, 'Клиника Б');
  });

  it('первая публикация — редакция 1; клиника без записи работает по последней и фиксируется на ней', async () => {
    await svc.publish('checklists', [cl('ЧЛ 1', 'п1')], 'm', 'm');
    expect((await svc.index('checklists')).map((e) => e.no)).toEqual([1]);
    expect(await svc.catalog(A, 'checklists', [])).toEqual([cl('ЧЛ 1', 'п1')]);
    expect(await svc.adoptedNo(A, 'checklists')).toBe(1);
  });

  it('новая редакция не подменяет принятую: клиника остаётся на прежней, видит рекомендацию с перечнем изменений', async () => {
    await svc.publish('checklists', [cl('ЧЛ 1', 'п1')], 'm', 'm');
    await svc.catalog(A, 'checklists', []);
    await svc.publish('checklists', [cl('ЧЛ 1', 'п1', 'п2'), cl('ЧЛ 2', 'x')], 'm', 'm');
    expect(await svc.catalog(A, 'checklists', [])).toEqual([cl('ЧЛ 1', 'п1')]);
    const { recommendations } = await svc.recommendations(admin);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({ catalog: 'checklists', adopted: 1, latest: 2, status: 'pending' });
    expect(recommendations[0]!.changes.join(' | ')).toContain('добавлено: ЧЛ 2');
    expect(recommendations[0]!.changes.join(' | ')).toContain('изменено: ЧЛ 1');
  });

  it('принять — переходит на последнюю; отклонить — остаётся, рекомендация «отклонена», новая редакция снова предлагается', async () => {
    await svc.publish('checklists', [cl('ЧЛ 1', 'п1')], 'm', 'm');
    await svc.catalog(A, 'checklists', []);
    await svc.publish('checklists', [cl('ЧЛ 1', 'п1', 'п2')], 'm', 'm');
    await svc.decline(admin, 'checklists');
    expect((await svc.recommendations(admin)).recommendations[0]!.status).toBe('declined');
    expect(await svc.adoptedNo(A, 'checklists')).toBe(1);
    await svc.publish('checklists', [cl('ЧЛ 1', 'п1', 'п2', 'п3')], 'm', 'm');
    expect((await svc.recommendations(admin)).recommendations[0]).toMatchObject({ latest: 3, status: 'pending' });
    expect(await svc.accept(admin, 'checklists')).toEqual({ ok: true, adopted: 3 });
    expect(await svc.catalog(A, 'checklists', [])).toEqual([cl('ЧЛ 1', 'п1', 'п2', 'п3')]);
    expect((await svc.recommendations(admin)).recommendations).toEqual([]);
  });

  it('принятие клиники А не затрагивает клинику Б (изоляция арендатора)', async () => {
    await svc.publish('checklists', [cl('ЧЛ 1', 'п1')], 'm', 'm');
    await svc.catalog(A, 'checklists', []);
    await svc.catalog(B, 'checklists', []);
    await svc.publish('checklists', [cl('ЧЛ 1', 'п1', 'п2')], 'm', 'm');
    await svc.accept(admin, 'checklists');
    expect(await svc.adoptedNo(A, 'checklists')).toBe(2);
    expect(await svc.adoptedNo(B, 'checklists')).toBe(1);
    expect((await svc.recommendations(adminB)).recommendations).toHaveLength(1);
  });

  it('решает только роль с adoption:decide — аудитор принять/отклонить не может', async () => {
    await svc.publish('checklists', [cl('a')], 'm', 'm');
    await svc.publish('checklists', [cl('a', 'x')], 'm', 'm');
    await expect(svc.accept(auditor, 'checklists')).rejects.toThrow();
    await expect(svc.decline(auditor, 'checklists')).rejects.toThrow();
  });

  it('до введения версий: живая версия становится редакцией 1, действующие клиники остаются на ней, новые — на последней', async () => {
    await repos.channels.set('platform', null, 'checklists', [cl('Старый', 'п')], { updatedBy: null });
    expect(await svc.catalog(A, 'checklists', [])).toEqual([cl('Старый', 'п')]);
    await svc.publish('checklists', [cl('Новый', 'п')], 'm', 'm');
    const idx = await svc.index('checklists');
    expect(idx.map((e) => e.no)).toEqual([1, 2]);
    expect(idx[0]!.changes[0]).toContain('Исходная редакция');
    expect(await svc.adoptedNo(A, 'checklists')).toBe(1);
    await repos.tenants.upsert('7719000010', 'Новая');
    expect(await svc.adoptedNo('7719000010', 'checklists')).toBe(2);
  });

  it('публикация без изменений не выпускает пустую редакцию', async () => {
    await svc.publish('checklists', [cl('a')], 'm', 'm');
    expect(await svc.publish('checklists', [cl('a')], 'm', 'm')).toBeNull();
    expect(await svc.index('checklists')).toHaveLength(1);
  });

  it('изданная редакция неизменяема: данные редакции 1 не меняются после выпуска редакции 2', async () => {
    await svc.publish('checklists', [cl('a', '1')], 'm', 'm');
    await svc.publish('checklists', [cl('a', '1', '2')], 'm', 'm');
    expect(await svc.editionData('checklists', 1, [])).toEqual([cl('a', '1')]);
    const again = await repos.channels.set('platform', null, 'standard_edition_data:checklists:1', [], { expectedVersion: 0, updatedBy: null });
    expect(again.ok).toBe(false);
  });

  it('телеметрия внедрения для методиста: приняли / ждут / отклонили', async () => {
    await svc.publish('checklists', [cl('a')], 'm', 'm');
    await svc.catalog(A, 'checklists', []);
    await svc.catalog(B, 'checklists', []);
    await svc.publish('checklists', [cl('a', 'x')], 'm', 'm');
    await svc.accept(admin, 'checklists');
    await svc.decline(adminB, 'checklists');
    const row = (await svc.adoptionReport(methodist)).find((r) => r.catalog === 'checklists')!;
    expect(row).toMatchObject({ latest: 2, accepted: 1, pending: 0, declined: 1 });
    await expect(svc.adoptionReport(admin)).rejects.toThrow();
  });

  it('каталог этапов: клиника видит принятую редакцию, новый этап появляется только после принятия', async () => {
    const st = (codes: number[]): Stage[] => codes.map((code) => ({ code, name: `Этап ${code}`, price: 1000, blocks: [] }));
    await svc.publish('stage_docs', st([1]), 'm', 'm');
    const stages = new StageService(repos);
    expect((await stages.getClinicView(admin)).map((s) => s.code)).toEqual([1]);
    await svc.publish('stage_docs', st([1, 2]), 'm', 'm');
    expect((await stages.getClinicView(admin)).map((s) => s.code)).toEqual([1]);
    expect((await svc.recommendations(admin)).recommendations[0]!.changes.join(' ')).toContain('добавлено: Этап 2');
    await svc.accept(admin, 'stage_docs');
    expect((await stages.getClinicView(admin)).map((s) => s.code)).toEqual([1, 2]);
  });

  describe('пилотный тираж и откат', () => {
    const platformAdmin = acc('platform_admin', '7726345678', 'platform');

    it('пилотная редакция видна только выбранным клиникам; остальные остаются на общей', async () => {
      await svc.publish('checklists', [cl('a')], 'm', 'm');
      await svc.catalog(A, 'checklists', []);
      await svc.catalog(B, 'checklists', []);
      await svc.publish('checklists', [cl('a', 'пилот')], 'm', 'm', [A]);
      expect((await svc.recommendations(admin)).recommendations[0]).toMatchObject({ latest: 2, status: 'pending' });
      expect((await svc.recommendations(adminB)).recommendations).toEqual([]);
      await svc.accept(admin, 'checklists');
      expect(await svc.catalog(A, 'checklists', [])).toEqual([cl('a', 'пилот')]);
      expect(await svc.catalog(B, 'checklists', [])).toEqual([cl('a')]);
      const row = (await svc.adoptionReport(methodist)).find((r) => r.catalog === 'checklists')!;
      expect(row.pilot).toMatchObject({ no: 2, inns: [A] });
      expect(row.pilot?.until).toBe(addDays(todayString(), 7));
      expect(row).toMatchObject({ accepted: 2, pending: 0 }); // Б на своей последней доступной
    });

    it('клиника вне пилота не может принять пилотную редакцию; новая клиника получает общую, не пилотную', async () => {
      await svc.publish('checklists', [cl('a')], 'm', 'm');
      await svc.publish('checklists', [cl('a', 'пилот')], 'm', 'm', [A]);
      expect(await svc.accept(adminB, 'checklists')).toMatchObject({ ok: true, adopted: 1 });
      await repos.tenants.upsert('7719000010', 'Новая');
      expect(await svc.adoptedNo('7719000010', 'checklists')).toBe(1);
    });

    it('если все редакции пилотные, клиника вне пилота не получает пилотные данные из живого канала', async () => {
      await svc.publish('checklists', [cl('пилотный')], 'm', 'm', [A]);
      await repos.channels.set('platform', null, 'checklists', [cl('пилотный')], { updatedBy: null }); // как делает applyPublish
      expect(await svc.catalog(B, 'checklists', [])).toEqual([]);
      expect(await svc.catalog(A, 'checklists', [])).toEqual([cl('пилотный')]);
    });

    it('выпуск для всех: рекомендация появляется у остальных; повторный выпуск — ошибка; нужен standard:publish', async () => {
      await svc.publish('checklists', [cl('a')], 'm', 'm');
      await svc.catalog(B, 'checklists', []);
      await svc.publish('checklists', [cl('a', 'x')], 'm', 'm', [A]);
      await expect(svc.release(auditor, 'checklists', 2)).rejects.toThrow();
      expect((await svc.release(platformAdmin, 'checklists', 2)).ok).toBe(true);
      expect((await svc.recommendations(adminB)).recommendations[0]).toMatchObject({ latest: 2, status: 'pending' });
      expect((await svc.release(platformAdmin, 'checklists', 2)).ok).toBe(false);
    });

    it('откат клиники на предыдущую редакцию: возвращает каталог, новая не навязывается повторно', async () => {
      await svc.publish('checklists', [cl('v1')], 'm', 'm');
      await svc.catalog(A, 'checklists', []);
      await svc.publish('checklists', [cl('v2')], 'm', 'm');
      await svc.accept(admin, 'checklists');
      expect((await svc.rollbackTargets(admin, 'checklists')).map((e) => e.no)).toEqual([1]);
      expect(await svc.rollback(admin, 'checklists', 1)).toEqual({ ok: true, adopted: 1 });
      expect(await svc.catalog(A, 'checklists', [])).toEqual([cl('v1')]);
      expect((await svc.recommendations(admin)).recommendations[0]!.status).toBe('declined');
      await svc.publish('checklists', [cl('v3')], 'm', 'm');
      expect((await svc.recommendations(admin)).recommendations[0]).toMatchObject({ latest: 3, status: 'pending' });
    });

    it('откат: только на более раннюю редакцию, только с правом adoption:decide, клиника Б не затронута', async () => {
      await svc.publish('checklists', [cl('v1')], 'm', 'm');
      await svc.catalog(A, 'checklists', []);
      await svc.catalog(B, 'checklists', []);
      await svc.publish('checklists', [cl('v2')], 'm', 'm');
      await svc.accept(admin, 'checklists');
      await svc.accept(adminB, 'checklists');
      expect((await svc.rollback(admin, 'checklists', 2)).ok).toBe(false);
      await expect(svc.rollback(auditor, 'checklists', 1)).rejects.toThrow();
      await svc.rollback(admin, 'checklists', 1);
      expect(await svc.adoptedNo(B, 'checklists')).toBe(2);
    });
  });

  // Даты редакций (publishedAt/pilotUntil) — реальный календарь (todayString()), а не
  // repos.clock: изданная редакция обязана нести настоящую дату публикации, а не дату
  // тестовых часов. Поэтому здесь двигаем системное время vitest, а не repos.clock.
  describe('автопродвижение пилота (docs «План развития продукта» §8)', () => {
    afterEach(() => vi.useRealTimers());

    it('до истечения срока автопродвижение ничего не трогает', async () => {
      await svc.publish('checklists', [cl('a')], 'm', 'm');
      await svc.publish('checklists', [cl('a', 'пилот')], 'm', 'm', [A]);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 6 * 86_400_000); // грация — 7 дней
      expect(await svc.autoPromotePilots()).toEqual([]);
      expect((await svc.index('checklists')).at(-1)?.pilot).toEqual([A]);
    });

    it('срок прошёл, возражений нет — пилот выпускается для всех сам, как по кнопке', async () => {
      await svc.publish('checklists', [cl('a')], 'm', 'm');
      await svc.catalog(B, 'checklists', []);
      await svc.publish('checklists', [cl('a', 'пилот')], 'm', 'm', [A]);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 7 * 86_400_000 + 86_400_000);
      expect(await svc.autoPromotePilots()).toEqual([{ catalog: 'checklists', no: 2 }]);
      const meta = (await svc.index('checklists')).find((e) => e.no === 2)!;
      expect(meta.pilot).toBeUndefined();
      expect(meta.pilotUntil).toBeUndefined();
      expect((await svc.recommendations(adminB)).recommendations[0]).toMatchObject({ latest: 2, status: 'pending' });
      // повторный тик планировщика не находит уже выпущенных пилотов — идемпотентно
      expect(await svc.autoPromotePilots()).toEqual([]);
    });

    it('пилотная клиника отказалась (decline) — автопродвижение пропускает редакцию до ручного решения методиста', async () => {
      await svc.publish('checklists', [cl('a')], 'm', 'm');
      await svc.catalog(A, 'checklists', []);
      await svc.publish('checklists', [cl('a', 'пилот')], 'm', 'm', [A]);
      await svc.decline(admin, 'checklists');
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 7 * 86_400_000 + 86_400_000);
      expect(await svc.autoPromotePilots()).toEqual([]);
      expect((await svc.index('checklists')).at(-1)?.pilot).toEqual([A]);
    });

    it('несколько каталогов с просроченными пилотами — продвигаются оба', async () => {
      await svc.publish('checklists', [cl('a')], 'm', 'm');
      await svc.publish('checklists', [cl('a', 'п')], 'm', 'm', [A]);
      await svc.publish('cycle_master', { dirs: [], capaTerms: [] }, 'm', 'm');
      await svc.publish('cycle_master', { dirs: [{ name: 'x' }], capaTerms: [] }, 'm', 'm', [A]);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 7 * 86_400_000 + 86_400_000);
      const promoted = await svc.autoPromotePilots();
      expect(promoted.map((p) => p.catalog).sort()).toEqual(['checklists', 'cycle_master']);
    });
  });
});
