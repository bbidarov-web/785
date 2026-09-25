import { StandardEditionService } from '../standard/editions.js';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { decodeDataUrl } from '../shared/fileUpload.js';
import type { SummaryFileEntry, SummaryRowDef } from '../shared/channelShapes.js';

export type SummaryResult<T> = { ok: true } & T | { ok: false; error: string };

const MAX_FILE_BYTES = 8_000_000;

export interface SummaryRowView {
  name: string;
  note: string;
  required: boolean;
  file: SummaryFileEntry | null;
}

/**
 * Сводный отчёт (README «Кабинет клиники»: «состав задаёт методист, файлы
 * формирует и загружает клиника» — дословно из
 * reference/prototype/Обход - мобильный.dc.html, комментарий у `sumNote`).
 * Состав — платформенный канал `summary_master` (методист, `standard:publish`,
 * см. `CatalogService`), файлы — тенантский `summary_files` (клиника, `doc:write`).
 */
export class SummaryService {
  constructor(private repos: Repos) {}

  async getView(account: Account): Promise<SummaryRowView[]> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'summary:view', null, account.inn);
    const [master, files] = await Promise.all([
      new StandardEditionService(this.repos).catalog<SummaryRowDef[]>(account.inn, 'summary_master', []),
      this.repos.channels.get<Record<string, SummaryFileEntry>>('tenant', account.inn, 'summary_files', {}),
    ]);
    return master.map((row) => ({ name: row.name, note: row.note, required: row.req, file: files.data[row.name] ?? null }));
  }

  async uploadFile(account: Account, rowName: string, fileName: string, base64: string): Promise<SummaryResult<{ file: SummaryFileEntry }>> {
    await assertPermission(this.repos.auditLog, account, 'doc:write', 'summary:upload', rowName, account.inn);
    const master = await new StandardEditionService(this.repos).catalog<SummaryRowDef[]>(account.inn, 'summary_master', []);
    if (!master.some((r) => r.name === rowName)) return { ok: false, error: 'Строка сводного отчёта не найдена в составе методиста' };
    const decoded = decodeDataUrl(base64);
    if (!decoded) return { ok: false, error: 'Не удалось прочитать файл' };
    if (decoded.data.byteLength > MAX_FILE_BYTES) return { ok: false, error: 'Файл слишком большой' };
    const saved = await this.repos.files.save(account.inn, decoded.contentType, decoded.data);

    const today = (() => {
      const d = this.repos.clock.now();
      const p = (n: number) => String(n).padStart(2, '0');
      return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
    })();
    const entry: SummaryFileEntry = { fileId: saved.id, fileName, date: today, uploadedBy: account.id };

    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, SummaryFileEntry>>('tenant', account.inn, 'summary_files', {});
      const next = { ...rec.data, [rowName]: entry };
      const res = await this.repos.channels.set('tenant', account.inn, 'summary_files', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, file: entry };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  async removeFile(account: Account, rowName: string): Promise<SummaryResult<Record<string, unknown>>> {
    await assertPermission(this.repos.auditLog, account, 'doc:write', 'summary:remove', rowName, account.inn);
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, SummaryFileEntry>>('tenant', account.inn, 'summary_files', {});
      if (!(rowName in rec.data)) return { ok: false, error: 'Файл не найден' };
      const next = { ...rec.data };
      delete next[rowName];
      const res = await this.repos.channels.set('tenant', account.inn, 'summary_files', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }
}
