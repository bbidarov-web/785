import { describe, expect, it } from 'vitest';
import { passwordIssues } from './password.js';

describe('passwordIssues', () => {
  it('принимает нормальный пароль', () => {
    expect(passwordIssues('qwerty12')).toEqual([]);
  });

  it('требует минимум 8 символов', () => {
    expect(passwordIssues('a1b2c3')).toContain('не короче 8 символов');
  });

  it('требует хотя бы одну букву', () => {
    expect(passwordIssues('12345678')).toContain('хотя бы одна буква');
  });

  it('требует хотя бы одну цифру', () => {
    expect(passwordIssues('qwertyui')).toContain('хотя бы одна цифра');
  });

  it('отклоняет пробелы по краям', () => {
    expect(passwordIssues(' qwerty12')).toContain('без пробелов по краям');
    expect(passwordIssues('qwerty12 ')).toContain('без пробелов по краям');
  });

  it('принимает кириллицу как букву', () => {
    expect(passwordIssues('пароль12')).toEqual([]);
  });
});
