import { describe, expect, it } from 'vitest';
import { innChecksum, normInn, validInn } from './inn.js';

describe('ИНН', () => {
  it('normInn убирает всё, кроме цифр', () => {
    expect(normInn(' 77-07 083893 ')).toBe('7707083893');
  });

  it('validInn принимает 10 (юрлицо) и 12 (ИП) цифр', () => {
    expect(validInn('7707083893')).toBe(true);
    expect(validInn('500100732259')).toBe(true);
    expect(validInn('123')).toBe(false);
    expect(validInn('12345678901')).toBe(false); // 11 цифр — не бывает
  });

  it('innChecksum подтверждает реальные ИНН (10 цифр)', () => {
    expect(innChecksum('7707083893')).toBe(true); // ПАО Сбербанк
    expect(innChecksum('7736050003')).toBe(true);
  });

  it('innChecksum подтверждает валидный ИНН ИП (12 цифр)', () => {
    expect(innChecksum('500100732259')).toBe(true);
  });

  it('innChecksum отклоняет опечатку в контрольном разряде', () => {
    expect(innChecksum('7707083894')).toBe(false);
    expect(innChecksum('500100732258')).toBe(false);
  });

  it('innChecksum отклоняет опечатку в значащем разряде (не тот ИНН, не тот "второй клиникой")', () => {
    expect(innChecksum('7707083883')).toBe(false);
  });

  it('innChecksum возвращает false для неверной длины', () => {
    expect(innChecksum('123')).toBe(false);
  });
});
