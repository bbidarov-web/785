import { can } from '@kontur785/shared';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission, PermissionDeniedError } from '../rbac/service.js';
import type { Stage, StagePaymentState } from '../shared/channelShapes.js';
import { DocumentService } from '../documents/service.js';

export type StageResult<T> = { ok: true } & T | { ok: false; error: string };

export interface StageDocView {
  name: string;
  granted: boolean;
}

export interface StageBlockView {
  key: string;
  num: string;
  name: string;
  docs: StageDocView[];
}

export interface StageView {
  code: number;
  name: string;
  price: number;
  payment: StagePaymentState;
  blocks: StageBlockView[];
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Этапы внедрения и документы (README «Кабинет клиники»): «Документы
 * открываются уже заполненными: бланк выбирается по виду документа, в
 * переменные подставляются реквизиты профиля и ответственный по направлению».
 * Оплата этапа открывает СОСТАВ, но не шаблоны — шаблон отдаёт
 * `getDocumentContent` только при наличии выдачи (`DocumentService`, уже
 * перенесён) И оплаты этапа, в который документ входит (SERVER.md §5).
 */
export class StageService {
  private documents: DocumentService;

  constructor(private repos: Repos) {
    this.documents = new DocumentService(repos);
  }

  private assertReadAccess(account: Account): void {
    // читают и клиника (doc:read), и панель, готовящая каталог (standard:read) —
    // это опубликованный справочник, а не чувствительные данные конкретной клиники
    if (!can(account.role, 'doc:read') && !can(account.role, 'standard:read')) {
      throw new PermissionDeniedError('doc:read');
    }
  }

  async getCatalog(): Promise<Stage[]> {
    return (await this.repos.channels.get<Stage[]>('platform', null, 'stage_docs', [])).data;
  }

  async getClinicView(account: Account): Promise<StageView[]> {
    this.assertReadAccess(account);
    const [catalog, paidRec, grants] = await Promise.all([
      this.getCatalog(),
      this.repos.channels.get<Record<number, StagePaymentState>>('tenant', account.inn, 'stage_paid', {}),
      this.documents.listActiveGrants(account.inn),
    ]);
    return catalog.map((stage) => ({
      code: stage.code,
      name: stage.name,
      price: stage.price,
      payment: paidRec.data[stage.code] ?? { status: 'none', requestedAt: null, requestedBy: null, confirmedAt: null, confirmedBy: null, amount: 0 },
      blocks: stage.blocks.map((b) => ({
        key: b.key,
        num: b.num,
        name: b.name,
        docs: b.docs.map((d) => ({ name: d.name, granted: !!grants[d.name] })),
      })),
    }));
  }

  /** Только администратор клиники заказывает и оплачивает этапы (order:write). */
  async requestPayment(account: Account, stageCode: number): Promise<StageResult<{ payment: StagePaymentState }>> {
    await assertPermission(this.repos.auditLog, account, 'order:write', 'stage:request-payment', String(stageCode), account.inn);
    const catalog = await this.getCatalog();
    const stage = catalog.find((s) => s.code === stageCode);
    if (!stage) return { ok: false, error: 'Этап не найден в каталоге' };

    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<number, StagePaymentState>>('tenant', account.inn, 'stage_paid', {});
      const current = rec.data[stageCode];
      if (current?.status === 'paid') return { ok: false, error: 'Этап уже оплачен' };
      if (current?.status === 'pending') return { ok: false, error: 'Счёт уже выставлен, ожидает подтверждения оператора' };
      const payment: StagePaymentState = { status: 'pending', requestedAt: today(), requestedBy: account.id, confirmedAt: null, confirmedBy: null, amount: stage.price };
      const next = { ...rec.data, [stageCode]: payment };
      const res = await this.repos.channels.set('tenant', account.inn, 'stage_paid', next, { expectedVersion: rec.version, updatedBy: account.id });
      if (res.ok) return { ok: true, payment };
    }
    return { ok: false, error: 'Не удалось сохранить — слишком много параллельных правок, повторите' };
  }

  /** Документ отдаётся только при выдаче И оплаченном этапе — обе проверки на API, не в интерфейсе (SERVER.md §5). */
  async getDocumentContent(account: Account, docName: string): Promise<StageResult<{ content: string }>> {
    this.assertReadAccess(account);
    const [catalog, paidRec] = await Promise.all([
      this.getCatalog(),
      this.repos.channels.get<Record<number, StagePaymentState>>('tenant', account.inn, 'stage_paid', {}),
    ]);
    let found: { stageCode: number; template: string } | null = null;
    for (const stage of catalog) {
      for (const block of stage.blocks) {
        const doc = block.docs.find((d) => d.name === docName);
        if (doc) {
          found = { stageCode: stage.code, template: doc.template };
          break;
        }
      }
      if (found) break;
    }
    if (!found) return { ok: false, error: 'Документ не найден в каталоге' };
    if (paidRec.data[found.stageCode]?.status !== 'paid') {
      return { ok: false, error: 'Этап не оплачен — состав документа недоступен' };
    }
    const granted = await this.documents.getTemplateIfGranted(account.inn, docName, async () => found!.template);
    if (!granted.ok) return granted;

    const docasg = (await this.repos.channels.get<Record<string, string>>('tenant', account.inn, 'docasg', {})).data;
    const tenant = await this.repos.tenants.findByInn(account.inn);
    const content = granted.content
      .replaceAll('{{org}}', tenant?.name ?? account.org ?? `ИНН ${account.inn}`)
      .replaceAll('{{inn}}', account.inn)
      .replaceAll('{{date}}', today())
      .replaceAll('{{responsible}}', docasg[docName] ?? 'не назначен');
    return { ok: true, content };
  }
}
