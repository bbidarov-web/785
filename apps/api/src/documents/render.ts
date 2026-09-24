import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * Генерация DOCX/PDF из готового текста документа (README «Файлы и
 * электронная подпись» → закрыто минимально жизнеспособно: реквизиты уже
 * подставлены в `StageService.getDocumentContent`, здесь — только упаковка
 * в файл). Кириллица: docx не требует внедрения шрифта (Word сам находит
 * системный шрифт по имени), а pdf-lib — требует: три встроенных 14 шрифтов
 * PDF не знают кириллицы вообще, поэтому шрифт внедряется явно (DejaVu Sans —
 * лицензия Bitstream Vera прямо разрешает встраивание в документ).
 */

const require = createRequire(import.meta.url);
let cachedFontBytes: Buffer | null = null;

function loadCyrillicFont(): Buffer {
  if (!cachedFontBytes) {
    const pkgJson = require.resolve('dejavu-fonts-ttf/package.json');
    cachedFontBytes = readFileSync(path.join(path.dirname(pkgJson), 'ttf', 'DejaVuSans.ttf'));
  }
  return cachedFontBytes;
}

export async function renderDocx(title: string, bodyText: string): Promise<Buffer> {
  const paragraphs = bodyText.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] }));
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 28 })] }),
        new Paragraph({ children: [] }),
        ...paragraphs,
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

const PAGE_WIDTH = 595.28; // A4 в пунктах (210мм)
const PAGE_HEIGHT = 841.89; // A4 (297мм)
const MARGIN = 56; // ~20мм
const FONT_SIZE = 11;
const TITLE_SIZE = 15;
const LINE_HEIGHT = FONT_SIZE * 1.4;

/** Построчная разбивка с переносом по словам под ширину страницы — pdf-lib не переносит текст сам. */
function wrapLine(line: string, font: import('pdf-lib').PDFFont, size: number, maxWidth: number): string[] {
  if (!line) return [''];
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  out.push(current);
  return out;
}

export async function renderPdf(title: string, bodyText: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(loadCyrillicFont(), { subset: true });
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPageIfNeeded = () => {
    if (y < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  page.drawText(title, { x: MARGIN, y, size: TITLE_SIZE, font, color: rgb(0, 0, 0) });
  y -= TITLE_SIZE * 1.6;

  for (const rawLine of bodyText.split('\n')) {
    for (const line of wrapLine(rawLine, font, FONT_SIZE, maxWidth)) {
      newPageIfNeeded();
      page.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
      y -= LINE_HEIGHT;
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
