import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepos } from '../testUtil/memoryRepos.js';
import { AuthService } from '../auth/service.js';
import { ManagerAssignmentService } from './managerAssignments.js';
import type { Account } from '../domain/types.js';

const CLINIC_A = '7712345671';
const CLINIC_B = '5001007322';
const CLINIC_C = '5044002348';

describe('«Ответственный менеджер» — закрепление sales_manager за клиниками', () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let svc: ManagerAssignmentService;
  let auth: AuthService;
  let admin: Account;
  let manager: Account;
  let head: Account;

  const reg = async (inn: string, login: string, side: 'clinic' | 'operator', role: string, fio = login) => {
    const r = await auth.register({ inn, login, password: 'Passw0rd2026', password2: 'Passw0rd2026', fio, side, role: role as never, org: side === 'clinic' ? 'Клиника ' + inn : undefined });
    if (!r.ok) throw new Error(r.error);
    return (await repos.accounts.update(r.account.id, { pending: false }));
  };

  beforeEach(async () => {
    repos = createMemoryRepos();
    auth = new AuthService(repos);
    svc = new ManagerAssignmentService(repos);
    admin = await reg('7726345678', 'padmin', 'operator', 'platform_admin');
    manager = await reg('7726345678', 'manager1', 'operator', 'sales_manager', 'Гусев Р. А.');
    head = await reg('7726345678', 'head1', 'operator', 'sales_head');
    await reg(CLINIC_A, 'clinica', 'clinic', 'clinic_admin');
    await reg(CLINIC_B, 'clinicb', 'clinic', 'clinic_admin');
    await reg(CLINIC_C, 'clinicc', 'clinic', 'clinic_admin');
  });

  it('без закрепления менеджер видит всех — старое поведение не ломается', async () => {
    expect(await svc.visibleInns(manager)).toBeNull();
    expect(await svc.list(admin)).toEqual([{ managerId: manager.id, managerFio: 'Гусев Р. А.', clinics: [] }]);
  });

  it('администратор закрепляет клиники — visibleInns и list отражают закрепление', async () => {
    const r = await svc.setForManager(admin, manager.id, [CLINIC_A, CLINIC_B]);
    expect(r.ok).toBe(true);
    expect(await svc.visibleInns(manager)).toEqual([CLINIC_A, CLINIC_B]);
    const list = await svc.list(admin);
    expect(list[0]!.clinics.map((c) => c.inn).sort()).toEqual([CLINIC_A, CLINIC_B].sort());
  });

  it('assertTenantVisible пропускает свою клинику и бросает на чужой', async () => {
    await svc.setForManager(admin, manager.id, [CLINIC_A]);
    await expect(svc.assertTenantVisible(manager, CLINIC_A)).resolves.toBeUndefined();
    await expect(svc.assertTenantVisible(manager, CLINIC_B)).rejects.toThrow('manager-assignment:scope');
  });

  it('супервизоры (sales_head, platform_admin) не подпадают под ограничение', async () => {
    await svc.setForManager(admin, manager.id, [CLINIC_A]);
    expect(await svc.visibleInns(head)).toBeNull();
    expect(await svc.visibleInns(admin)).toBeNull();
    await expect(svc.assertTenantVisible(head, CLINIC_B)).resolves.toBeUndefined();
  });

  it('пустой список — снять закрепление, а не запереть на нуле клиник', async () => {
    await svc.setForManager(admin, manager.id, [CLINIC_A]);
    expect(await svc.visibleInns(manager)).toEqual([CLINIC_A]);
    await svc.setForManager(admin, manager.id, []);
    expect(await svc.visibleInns(manager)).toBeNull();
  });

  it('нельзя закрепить несуществующую клинику или закрепить за не-менеджером', async () => {
    expect((await svc.setForManager(admin, manager.id, ['1234567890'])).ok).toBe(false);
    expect((await svc.setForManager(admin, head.id, [CLINIC_A])).ok).toBe(false);
  });

  it('дубликаты ИНН схлопываются', async () => {
    const r = await svc.setForManager(admin, manager.id, [CLINIC_A, CLINIC_A, CLINIC_A]);
    expect(r.ok && r.clinics).toHaveLength(1);
  });

  it('управлять закреплением и смотреть список может только администратор платформы', async () => {
    await expect(svc.setForManager(manager, manager.id, [CLINIC_A])).rejects.toThrow();
    await expect(svc.setForManager(head, manager.id, [CLINIC_A])).rejects.toThrow();
    await expect(svc.list(head)).rejects.toThrow();
    await expect(svc.list(manager)).rejects.toThrow();
  });
});
