import { describe, expect, it } from 'vitest';
import { assignees, buildStaffPositionMap, formatOwner, isMine, normalizeChecklistName } from './assignment.js';
import type { StaffMember } from './channelShapes.js';

describe('shared/assignment — разбор поля «назначение»', () => {
  describe('assignees', () => {
    it('null/undefined/пусто — пустой список', () => {
      expect(assignees(null)).toEqual([]);
      expect(assignees(undefined)).toEqual([]);
      expect(assignees('')).toEqual([]);
      expect(assignees('   ')).toEqual([]);
    });

    it('одно ФИО без филиала', () => {
      expect(assignees('Смирнов А. П.')).toEqual(['Смирнов А. П.']);
    });

    it('несколько человек через « + »', () => {
      expect(assignees('Смирнов А. П. + Иванова О. С.')).toEqual(['Смирнов А. П.', 'Иванова О. С.']);
    });

    it('отбрасывает филиал после « · »', () => {
      expect(assignees('Смирнов А. П. · Головная клиника')).toEqual(['Смирнов А. П.']);
    });

    it('несколько человек, у части есть филиал', () => {
      expect(assignees('Смирнов А. П. · Головная клиника + Иванова О. С.')).toEqual(['Смирнов А. П.', 'Иванова О. С.']);
    });

    it('терпимо к лишним пробелам вокруг «+»', () => {
      expect(assignees('Смирнов А. П.+Иванова О. С.')).toEqual(['Смирнов А. П.', 'Иванова О. С.']);
    });
  });

  describe('isMine', () => {
    it('true, если ФИО есть среди назначенных', () => {
      expect(isMine('Смирнов А. П. + Иванова О. С.', 'Иванова О. С.')).toBe(true);
    });

    it('false, если ФИО нет среди назначенных', () => {
      expect(isMine('Смирнов А. П.', 'Иванова О. С.')).toBe(false);
    });

    it('false для пустого назначения', () => {
      expect(isMine(null, 'Иванова О. С.')).toBe(false);
    });
  });

  describe('buildStaffPositionMap', () => {
    it('строит карту из каталога staff, когда он не пуст', () => {
      const staff: StaffMember[] = [{ fio: 'Смирнов А. П.', pos: 'Врач' }, { fio: 'Иванова О. С.', pos: 'Медсестра' }];
      expect(buildStaffPositionMap(staff, {})).toEqual({ 'Смирнов А. П.': 'Врач', 'Иванова О. С.': 'Медсестра' });
    });

    it('обрезает пробелы вокруг ФИО из staff', () => {
      const staff: StaffMember[] = [{ fio: '  Смирнов А. П.  ', pos: 'Врач' }];
      expect(buildStaffPositionMap(staff, {})).toEqual({ 'Смирнов А. П.': 'Врач' });
    });

    it('падает на staffByBranch из client_state, когда staff пуст', () => {
      const clientState = { staffByBranch: { branch1: [{ fio: 'Петров И. И.', pos: 'Санитар' }] } };
      expect(buildStaffPositionMap([], clientState)).toEqual({ 'Петров И. И.': 'Санитар' });
    });

    it('пустая карта, если и staff, и staffByBranch пусты', () => {
      expect(buildStaffPositionMap([], {})).toEqual({});
    });
  });

  describe('formatOwner', () => {
    it('«не назначен» для пустого назначения', () => {
      expect(formatOwner(null, {})).toBe('не назначен');
      expect(formatOwner('', {})).toBe('не назначен');
    });

    it('ФИО без должности, если её нет в карте', () => {
      expect(formatOwner('Смирнов А. П.', {})).toBe('Смирнов А. П.');
    });

    it('ФИО с должностью через « · »', () => {
      expect(formatOwner('Смирнов А. П.', { 'Смирнов А. П.': 'Врач' })).toBe('Смирнов А. П. · Врач');
    });

    it('несколько человек через « + », каждый со своей должностью', () => {
      const positions = { 'Смирнов А. П.': 'Врач', 'Иванова О. С.': 'Медсестра' };
      expect(formatOwner('Смирнов А. П. + Иванова О. С.', positions)).toBe('Смирнов А. П. · Врач + Иванова О. С. · Медсестра');
    });
  });

  describe('normalizeChecklistName', () => {
    it('null/undefined — пустая строка', () => {
      expect(normalizeChecklistName(null)).toBe('');
      expect(normalizeChecklistName(undefined)).toBe('');
    });

    it('убирает кавычки-ёлочки и обычные кавычки', () => {
      expect(normalizeChecklistName('«Чек-лист аудита»')).toBe('чек-лист аудита');
      expect(normalizeChecklistName('"Чек-лист аудита"')).toBe('чек-лист аудита');
      expect(normalizeChecklistName("'Чек-лист аудита'")).toBe('чек-лист аудита');
    });

    it('убирает числовой префикс «N · »', () => {
      expect(normalizeChecklistName('1 · Чек-лист аудита')).toBe('чек-лист аудита');
    });

    it('схлопывает повторяющиеся пробелы и обрезает края', () => {
      expect(normalizeChecklistName('  Чек-лист   Аудита  ')).toBe('чек-лист аудита');
    });

    it('разные написания одного чек-листа нормализуются к одному значению', () => {
      const a = normalizeChecklistName('«Чек-лист аудита»');
      const b = normalizeChecklistName('1 · "Чек-лист  Аудита"');
      expect(a).toBe(b);
    });
  });
});
