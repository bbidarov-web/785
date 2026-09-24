import { describe, expect, it } from 'vitest';
import { addDays, daysSince, daysUntil, formatDate, isBeforeToday, parseDate, todayString } from './date.js';

describe('shared/date — разбор и арифметика дат в формате ДД.ММ.ГГГГ', () => {
  it('formatDate/parseDate — туда и обратно без потерь', () => {
    const d = new Date(2026, 2, 5); // 5 марта 2026 — месяц 0-based
    expect(formatDate(d)).toBe('05.03.2026');
    expect(parseDate('05.03.2026').getTime()).toBe(d.getTime());
  });

  it('formatDate дополняет день и месяц нулём', () => {
    expect(formatDate(new Date(2026, 0, 1))).toBe('01.01.2026');
  });

  it('todayString возвращает сегодняшнюю дату в формате ДД.ММ.ГГГГ', () => {
    expect(todayString()).toBe(formatDate(new Date()));
  });

  it('addDays переносит через границу месяца', () => {
    expect(addDays('30.01.2026', 3)).toBe('02.02.2026');
  });

  it('addDays переносит через границу года', () => {
    expect(addDays('30.12.2026', 5)).toBe('04.01.2027');
  });

  it('addDays с отрицательным числом отсчитывает назад', () => {
    expect(addDays('05.01.2026', -10)).toBe('26.12.2025');
  });

  it('addDays корректно обрабатывает високосный год', () => {
    expect(addDays('28.02.2024', 1)).toBe('29.02.2024'); // 2024 — високосный
    expect(addDays('28.02.2025', 1)).toBe('01.03.2025'); // 2025 — нет
  });

  it('daysSince считает полные дни в прошлом как положительное число', () => {
    expect(daysSince(addDays(todayString(), -5))).toBe(5);
  });

  it('daysSince для сегодняшней даты — ноль', () => {
    expect(daysSince(todayString())).toBe(0);
  });

  it('daysSince для даты в будущем — отрицательное число', () => {
    expect(daysSince(addDays(todayString(), 3))).toBe(-3);
  });

  it('daysUntil — зеркало daysSince с обратным знаком', () => {
    const future = addDays(todayString(), 7);
    expect(daysUntil(future)).toBe(7);
    expect(daysUntil(future)).toBe(-daysSince(future));
  });

  it('isBeforeToday: вчера — true, сегодня и завтра — false', () => {
    expect(isBeforeToday(addDays(todayString(), -1))).toBe(true);
    expect(isBeforeToday(todayString())).toBe(false);
    expect(isBeforeToday(addDays(todayString(), 1))).toBe(false);
  });
});
