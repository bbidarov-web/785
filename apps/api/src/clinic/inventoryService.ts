import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { formatDate } from '../shared/date.js';
import { DocumentService } from '../documents/service.js';
import type { Stage, SummaryFileEntry, SummaryRowDef } from '../shared/channelShapes.js';

export interface InventoryRow {
  stageCode: number | null; // null — строка сводного отчёта, а не этапа
  zone: string;
  name: string;
  filled: boolean;
  filledLabel: string;
  filledAt: string | null;
  required: boolean;
}

export interface InventorySummary {
  total: number;
  filled: number;
  notFilled: number;
}

/**
 * Опись документов — единый контрольный лист по клинике (README «Кабинет
 * клиники»: «Опись документов»). Собирает состав из ДВУХ реальных
 * источников — документы этапов (`Stage.blocks[].docs`, статус — активная
 * выдача через `DocumentService`) и сводный отчёт (`summary_master`, статус —
 * загруженный файл). Осознанно НЕ показывает «редакцию»/«эталон vs добавлено
 * клиникой», как в прототипе (`reference/prototype/Личный кабинет
 * ВКК.dc.html`, `docInventory()`) — этих полей нет ни у одного документа в
 * перенесённой модели (см. README «Известные ограничения»), выдумывать их
 * значило бы показать недостоверные данные.
 */
export class InventoryService {
  private documents: DocumentService;

  constructor(private repos: Repos) {
    this.documents = new DocumentService(repos);
  }

  async getInventory(account: Account): Promise<{ rows: InventoryRow[]; summary: InventorySummary }> {
    await assertPermission(this.repos.auditLog, account, 'doc:read', 'inventory:view', null, account.inn);
    const [catalog, summaryMaster, grants, summaryFiles] = await Promise.all([
      this.repos.channels.get<Stage[]>('platform', null, 'stage_docs', []).then((r) => r.data),
      this.repos.channels.get<SummaryRowDef[]>('platform', null, 'summary_master', []).then((r) => r.data),
      this.documents.listActiveGrants(account.inn),
      this.repos.channels.get<Record<string, SummaryFileEntry>>('tenant', account.inn, 'summary_files', {}).then((r) => r.data),
    ]);

    const rows: InventoryRow[] = [];
    for (const stage of catalog) {
      for (const block of stage.blocks) {
        for (const doc of block.docs) {
          const grant = grants[doc.name];
          rows.push({
            stageCode: stage.code,
            zone: `Этап ${stage.code} · ${block.name}`,
            name: doc.name,
            filled: !!grant,
            filledLabel: grant ? 'выдан' : 'не выдан',
            filledAt: grant ? formatDate(grant.at) : null,
            required: true,
          });
        }
      }
    }
    for (const row of summaryMaster) {
      const file = summaryFiles[row.name];
      rows.push({
        stageCode: null,
        zone: 'Сводный отчёт',
        name: row.name,
        filled: !!file,
        filledLabel: file ? 'загружен' : 'не загружен',
        filledAt: file?.date ?? null,
        required: row.req,
      });
    }

    const filled = rows.filter((r) => r.filled).length;
    return { rows, summary: { total: rows.length, filled, notFilled: rows.length - filled } };
  }
}
