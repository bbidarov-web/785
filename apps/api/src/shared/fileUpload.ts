/** Разбор data URL (`data:<contentType>;base64,<...>`) — общий для обхода, сводного отчёта и любой другой загрузки файла через JSON-тело. */
export function decodeDataUrl(input: string): { contentType: string; data: Buffer } | null {
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(input.trim());
  if (!m) return null;
  const [, contentType, base64] = m;
  try {
    return { contentType: contentType!, data: Buffer.from(base64!, 'base64') };
  } catch {
    return null;
  }
}
