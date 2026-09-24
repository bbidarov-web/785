import { describe, expect, it } from 'vitest';
import { decodeDataUrl } from './fileUpload.js';

describe('shared/fileUpload — разбор data URL', () => {
  it('разбирает корректный data URL', () => {
    const base64 = Buffer.from('hello world').toString('base64');
    const result = decodeDataUrl(`data:text/plain;base64,${base64}`);
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('text/plain');
    expect(result!.data.toString('utf8')).toBe('hello world');
  });

  it('поддерживает составной contentType (image/png)', () => {
    const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const result = decodeDataUrl(`data:image/png;base64,${base64}`);
    expect(result!.contentType).toBe('image/png');
    expect([...result!.data]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('обрезает внешние пробелы', () => {
    const base64 = Buffer.from('x').toString('base64');
    const result = decodeDataUrl(`  data:text/plain;base64,${base64}  `);
    expect(result!.data.toString('utf8')).toBe('x');
  });

  it('null без префикса data:', () => {
    expect(decodeDataUrl('text/plain;base64,aGVsbG8=')).toBeNull();
  });

  it('null без base64,', () => {
    expect(decodeDataUrl('data:text/plain,hello')).toBeNull();
  });

  it('null для пустой строки', () => {
    expect(decodeDataUrl('')).toBeNull();
  });

  it('null, если после base64, ничего нет', () => {
    expect(decodeDataUrl('data:text/plain;base64,')).toBeNull();
  });
});
