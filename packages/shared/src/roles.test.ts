import { describe, expect, it } from 'vitest';
import { ROLES, can, isPlatformRole, isClinicRole, isRole } from './roles.js';

describe('ROLES matrix', () => {
  it('содержит ровно 9 ролей продукта', () => {
    expect(Object.keys(ROLES)).toHaveLength(9);
  });

  it('методист не подтверждает оплату (разделение полномочий платформы)', () => {
    expect(can('methodist', 'money:write')).toBe(false);
  });

  it('менеджер не публикует эталон (разделение полномочий платформы)', () => {
    expect(can('sales_manager', 'standard:publish')).toBe(false);
  });

  it('только администратор платформы управляет ролями', () => {
    for (const role of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
      const has = can(role, 'role:manage');
      if (role === 'platform_admin') expect(has).toBe(true);
      else expect(has).toBe(false);
    }
  });

  it('вторая рука по деньгам есть у руководителя продаж и администратора, но не у менеджера', () => {
    expect(can('sales_head', 'second:money')).toBe(true);
    expect(can('platform_admin', 'second:money')).toBe(true);
    expect(can('sales_manager', 'second:money')).toBe(false);
  });

  it('исполнитель не видит денег и не правит состав документов', () => {
    expect(can('nurse', 'money:read')).toBe(false);
    expect(can('nurse', 'doc:write')).toBe(false);
  });

  it('isRole различает известные и неизвестные роли', () => {
    expect(isRole('nurse')).toBe(true);
    expect(isRole('superadmin')).toBe(false);
  });

  it('isPlatformRole/isClinicRole не пересекаются', () => {
    for (const role of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
      expect(isPlatformRole(role) && isClinicRole(role)).toBe(false);
      expect(isPlatformRole(role) || isClinicRole(role)).toBe(true);
    }
  });
});
