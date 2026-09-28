import { describe, expect, it } from 'vitest';
import { renderDocx, renderPdf } from './render.js';

describe('documents/render — DOCX/PDF из готового текста документа', () => {
  it('renderDocx возвращает валидный .docx (ZIP-контейнер OOXML)', async () => {
    const buf = await renderDocx('Приказ о создании комиссии', 'Приказ · ООО «Медицина Плюс» · ИНН 7712345671\nОтветственный: Иванова М. А.');
    expect(buf.length).toBeGreaterThan(500);
    // .docx — это ZIP-архив, начинается с сигнатуры PK
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('renderPdf возвращает валидный PDF с кириллицей, без исключений при внедрении шрифта', async () => {
    const buf = await renderPdf('Приказ о создании комиссии', 'Приказ · ООО «Медицина Плюс» · ИНН 7712345671\nОтветственный: Иванова М. А. · лицензия ЛО-77-01-123456');
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  // 200 строк реального рендера шрифта в pdf-lib — под покрытием (v8 coverage) заметно медленнее
  // обычного прогона, отсюда увеличенный таймаут теста, а не бага в самом рендере.
  it('renderPdf переносит длинный текст на несколько страниц без падения', async () => {
    const longText = Array.from({ length: 200 }, (_, i) => `Строка номер ${i + 1} с довольно длинным содержанием для проверки переноса по словам и постраничной разбивки документа.`).join('\n');
    const buf = await renderPdf('Длинный документ', longText);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 15000);

  it('renderPdf не падает на пустом тексте', async () => {
    const buf = await renderPdf('Пустой документ', '');
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
