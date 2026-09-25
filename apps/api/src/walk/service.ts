import { StandardEditionService } from '../standard/editions.js';
import type { Repos } from '../domain/ports.js';
import type { Account } from '../domain/types.js';
import { assertPermission } from '../rbac/service.js';
import { todayString } from '../shared/date.js';
import { buildStaffPositionMap, formatOwner, isMine, normalizeChecklistName } from '../shared/assignment.js';
import { decodeDataUrl } from '../shared/fileUpload.js';
import type { AuditPlanItem, ChecklistDef, ClientStateShape, StaffMember, WalkResultEntry } from '../shared/channelShapes.js';
import type { WalkDetailDto, WalkItemAnswerDto, WalkListItemDto } from './types.js';

export type WalkOpResult<T> = { ok: true } & T | { ok: false; error: string };

const KIND_LABEL: Record<string, string> = { плановая: 'плановая', внеплановая: 'внеплановая', целевая: 'целевая' };
const MAX_PHOTO_BYTES = 2_000_000; // клиент сжимает фото до ~1200px/jpeg 0.72 перед отправкой — сервер только подстраховывается

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

interface ResolvedChecklist {
  boundName: string;
  items: string[];
  noCheck: boolean;
  noCheckNote: string;
}

/**
 * Мобильный обход — чек-листы с ответами, комментариями и фото (README).
 * Перенос ключевой бизнес-логики `renderVals()`/`finish()` из
 * `reference/prototype/Обход - мобильный.dc.html`: сопоставление плана
 * проверок с каталогом чек-листов методиста (нормализация имени — 1:1,
 * `normalizeChecklistName`), запрет отвечать за проверку, где не назначен,
 * идемпотентная запись (offline-очередь может повторить ту же операцию —
 * SERVER.md §6.5) и слияние вместо затирания при параллельной правке.
 *
 * «Оборудование» и «Сводный отчёт» — остальные два раздела того же мобильного
 * экрана (apps/web/src/app/walk/page.tsx) — используют не этот сервис, а те
 * же `EquipmentService`/`SummaryService` и HTTP-эндпоинты, что и `/clinic`
 * (apps/api/src/http/routes/clinicExtras.ts): сервер проверяет права по роли
 * сессии одинаково, независимо от того, какой фронтенд вызвал эндпоинт.
 * Фото-доказательство сохраняется независимо от ответа (ok/bad): ограничение
 * прототипа «резать» фото для не-нарушений было следствием лимита
 * localStorage ~5 МБ, а не бизнес-правилом — на реальном объектном хранилище
 * этого ограничения нет.
 */
export class WalkService {
  constructor(private repos: Repos) {}

  private async checklistCatalog(inn: string): Promise<ChecklistDef[]> {
    return new StandardEditionService(this.repos).catalog<ChecklistDef[]>(inn, 'checklists', []);
  }

  private resolveChecklist(plan: AuditPlanItem, catalog: ChecklistDef[]): ResolvedChecklist {
    const byName = new Map(catalog.map((c) => [c.name, (c.items || []).filter(Boolean)]));
    const chosen = (plan.check || '').trim();
    if (!chosen) {
      return { boundName: plan.dir || plan.name || '', items: [], noCheck: true, noCheckNote: 'чек-лист не выбран — выберите его из перечня оператора в годовом цикле' };
    }
    if (byName.has(chosen)) return { boundName: chosen, items: byName.get(chosen)!, noCheck: false, noCheckNote: '' };
    const nrm = normalizeChecklistName(chosen);
    for (const [name, items] of byName) {
      if (normalizeChecklistName(name) === nrm) return { boundName: name, items, noCheck: false, noCheckNote: '' };
    }
    return {
      boundName: plan.dir || chosen,
      items: [],
      noCheck: true,
      noCheckNote: `чек-лист «${chosen}» нет в каталоге оператора — опубликуйте его или выберите из перечня`,
    };
  }

  private toListItem(plan: AuditPlanItem, resolved: ResolvedChecklist, entry: WalkResultEntry | undefined, owner: string, no: string): WalkListItemDto {
    const total = resolved.items.length || (resolved.noCheck ? 0 : 1);
    const answered = entry?.answered ?? 0;
    const bad = entry?.bad ?? 0;
    const finished = entry?.finished ?? false;
    const pct = total ? Math.round((answered / total) * 100) : 0;
    return {
      planId: plan.id,
      no,
      name: resolved.boundName || plan.name || plan.dir || 'Проверка',
      object: plan.object || '',
      branch: plan.branch || '',
      kind: KIND_LABEL[plan.kind || 'плановая'] || 'плановая',
      owner,
      planDate: plan.date || plan.due || '',
      noCheck: resolved.noCheck,
      noCheckNote: resolved.noCheckNote,
      answered,
      total,
      bad,
      pct,
      finished,
      status: finished ? (bad ? `закрыта · ${bad} нар.` : 'закрыта') : answered ? 'в работе' : 'не начата',
    };
  }

  private async assignedPlanFor(account: Account): Promise<{ plan: AuditPlanItem[]; catalog: ChecklistDef[]; owners: Record<string, string>; results: Record<string, WalkResultEntry> }> {
    const inn = account.inn;
    const [planRec, catalog, staff, clientState, resultsRec] = await Promise.all([
      this.repos.channels.get<AuditPlanItem[]>('tenant', inn, 'audit_plan', []),
      this.checklistCatalog(inn),
      this.repos.channels.get<StaffMember[]>('tenant', inn, 'staff', []),
      this.repos.channels.get<ClientStateShape>('tenant', inn, 'client_state', {}),
      this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', inn, 'walk_results', {}),
    ]);
    const positions = buildStaffPositionMap(staff.data, clientState.data);
    const plan = planRec.data.filter((p) => p && isMine(p.who, account.fio));
    return { plan, catalog, owners: positions, results: resultsRec.data };
  }

  async listAssigned(account: Account): Promise<WalkListItemDto[]> {
    await assertPermission(this.repos.auditLog, account, 'walk:run', 'walk:list', null, account.inn);
    const { plan, catalog, owners, results } = await this.assignedPlanFor(account);
    const sorted = plan
      .map((p) => ({ p, resolved: this.resolveChecklist(p, catalog) }))
      .sort((a, b) => (a.p.date || '').split('.').reverse().join('').localeCompare((b.p.date || '').split('.').reverse().join('')));
    return sorted.map(({ p, resolved }, i) =>
      this.toListItem(p, resolved, results[p.id], formatOwner(p.who, owners), 'П-' + String(i + 1).padStart(2, '0')),
    );
  }

  async getDetail(account: Account, planId: string): Promise<WalkOpResult<{ detail: WalkDetailDto }>> {
    await assertPermission(this.repos.auditLog, account, 'walk:run', 'walk:detail', planId, account.inn);
    return this.buildDetail(account, planId);
  }

  /** Без собственной проверки прав — вызывается только из методов, которые её уже сделали. */
  private async buildDetail(account: Account, planId: string): Promise<WalkOpResult<{ detail: WalkDetailDto }>> {
    const { plan, catalog, owners, results } = await this.assignedPlanFor(account);
    const idx = plan.findIndex((p) => p.id === planId);
    if (idx === -1) return { ok: false, error: 'Проверка не найдена среди ваших назначений' };
    const p = plan[idx]!;
    const resolved = this.resolveChecklist(p, catalog);
    const entry = results[planId];
    const listItem = this.toListItem(p, resolved, entry, formatOwner(p.who, owners), 'П-' + String(idx + 1).padStart(2, '0'));
    const items: WalkItemAnswerDto[] = resolved.items.map((text, i) => {
      const stored = entry?.items?.[i];
      return {
        index: i,
        text,
        answer: stored?.answer ?? '',
        comment: stored?.comment ?? '',
        hasPhoto: !!stored?.photoFileId,
        photoFileId: stored?.photoFileId ?? null,
      };
    });
    return { ok: true, detail: { ...listItem, items } };
  }

  async answerItem(
    account: Account,
    planId: string,
    input: { index: number; answer: 'ok' | 'bad'; comment?: string; photoBase64?: string },
    opId: string,
  ): Promise<WalkOpResult<{ detail: WalkDetailDto }>> {
    await assertPermission(this.repos.auditLog, account, 'walk:run', 'walk:answer', planId, account.inn);
    const inn = account.inn;
    const { plan, catalog, owners } = await this.assignedPlanFor(account);
    const p = plan.find((x) => x.id === planId);
    if (!p) return { ok: false, error: 'Проверка не найдена среди ваших назначений' };
    const resolved = this.resolveChecklist(p, catalog);
    if (resolved.noCheck) return { ok: false, error: resolved.noCheckNote };
    if (input.index < 0 || input.index >= resolved.items.length) return { ok: false, error: 'Пункт чек-листа не найден' };

    let photoFileId: string | null | undefined;
    if (input.photoBase64) {
      const decoded = decodeDataUrl(input.photoBase64);
      if (!decoded) return { ok: false, error: 'Не удалось прочитать снимок' };
      if (decoded.data.byteLength > MAX_PHOTO_BYTES) return { ok: false, error: 'Снимок слишком большой — сожмите перед отправкой' };
      const saved = await this.repos.files.save(inn, decoded.contentType, decoded.data);
      photoFileId = saved.id;
    }

    // конфликт версий по этому каналу означает, что кто-то ещё поменял walk_results
    // за это время — сливаем свою правку поверх свежих данных, а не затираем их
    // и не молчим (CLAUDE.md "конфликт — слияние или явная ошибка")
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', inn, 'walk_results', {});
      const all = rec.data;
      const current = all[planId];
      const items: WalkResultEntry['items'] = current?.items?.length
        ? current.items.slice()
        : resolved.items.map((text) => ({ text, answer: '' as const, comment: '', photoFileId: null }));
      const prevItem = items[input.index];
      items[input.index] = {
        text: resolved.items[input.index] ?? prevItem?.text ?? '',
        answer: input.answer,
        comment: input.comment ?? prevItem?.comment ?? '',
        photoFileId: photoFileId !== undefined ? photoFileId : (prevItem?.photoFileId ?? null),
      };
      const answered = items.filter((it) => it.answer).length;
      const bad = items.filter((it) => it.answer === 'bad').length;
      const entry: WalkResultEntry = {
        planId,
        walkId: planId,
        name: resolved.boundName || p.name || p.dir || 'Проверка',
        object: p.object || '',
        kind: p.kind || 'плановая',
        who: formatOwner(p.who, owners),
        finished: current?.finished ?? false,
        answered,
        total: items.length,
        bad,
        date: current?.date || (/\d{2}\.\d{2}\.\d{4}/.test(p.date || '') ? p.date! : today()),
        source: 'мобильный обход',
        items,
      };
      const next = { ...all, [planId]: entry };
      const res = await this.repos.channels.set('tenant', inn, 'walk_results', next, { expectedVersion: rec.version, updatedBy: account.id, opId });
      if (res.ok) {
        const detail = await this.buildDetail(account, planId);
        return detail.ok ? { ok: true, detail: detail.detail } : { ok: false, error: detail.error };
      }
      // idempotent-повтор уже применённой операции — не пытаемся снова, отдаём текущее состояние
      if ('idempotent' in res && res.idempotent) {
        const detail = await this.buildDetail(account, planId);
        return detail.ok ? { ok: true, detail: detail.detail } : { ok: false, error: detail.error };
      }
    }
    return { ok: false, error: 'Не удалось сохранить ответ — слишком много параллельных правок, повторите' };
  }

  async finish(account: Account, planId: string, opId: string): Promise<WalkOpResult<{ bad: number; total: number }>> {
    await assertPermission(this.repos.auditLog, account, 'walk:run', 'walk:finish', planId, account.inn);
    const inn = account.inn;
    for (let attempt = 0; attempt < 5; attempt++) {
      const rec = await this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', inn, 'walk_results', {});
      const current = rec.data[planId];
      if (!current) return { ok: false, error: 'Нечего завершать — сначала отметьте хотя бы один пункт' };
      if (current.answered < current.total) return { ok: false, error: 'Остались неотмеченные пункты — прокрутите список вверх' };
      // повторное завершение (ретрай офлайн-очереди) не должно менять уже присвоенный номер акта
      const year = new Date().getFullYear();
      const used = Object.values(rec.data).map((e) => /^А-(\d{4})-(\d+)$/.exec(e.actNo ?? '')).filter((m): m is RegExpExecArray => !!m && Number(m[1]) === year).map((m) => Number(m[2]));
      const actNo = current.actNo ?? `А-${year}-${String(Math.max(0, ...used) + 1).padStart(3, '0')}`;
      const entry: WalkResultEntry = { ...current, finished: true, actNo, finishedAt: current.finishedAt ?? todayString() };
      const next = { ...rec.data, [planId]: entry };
      const res = await this.repos.channels.set('tenant', inn, 'walk_results', next, { expectedVersion: rec.version, updatedBy: account.id, opId });
      if (res.ok) return { ok: true, bad: entry.bad, total: entry.total };
      if ('idempotent' in res && res.idempotent) return { ok: true, bad: entry.bad, total: entry.total };
    }
    return { ok: false, error: 'Не удалось завершить проверку — слишком много параллельных правок, повторите' };
  }

  /** Реестр актов обходов клиники — завершённые обходы с присвоенным номером. */
  async listActs(account: Account): Promise<{ planId: string; actNo: string; name: string; object: string; date: string; bad: number; total: number }[]> {
    await assertPermission(this.repos.auditLog, account, 'journal:read', 'walk:acts', null, account.inn);
    const rec = await this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', account.inn, 'walk_results', {});
    return Object.values(rec.data)
      .filter((e) => e.finished && e.actNo)
      .map((e) => ({ planId: e.planId, actNo: e.actNo!, name: e.name, object: e.object, date: e.finishedAt ?? e.date, bad: e.bad, total: e.total }))
      .sort((a, b) => b.actNo.localeCompare(a.actNo));
  }

  /** Текст акта обхода для печати (PDF собирает маршрут) — только завершённый обход СВОЕЙ клиники. */
  async getActText(account: Account, planId: string): Promise<WalkOpResult<{ title: string; body: string }>> {
    await assertPermission(this.repos.auditLog, account, 'journal:read', 'walk:act', planId, account.inn);
    const rec = await this.repos.channels.get<Record<string, WalkResultEntry>>('tenant', account.inn, 'walk_results', {});
    const e = rec.data[planId];
    if (!e || !e.finished || !e.actNo) return { ok: false, error: 'Акт формируется только по завершённому обходу' };
    const tenant = await this.repos.tenants.findByInn(account.inn);
    const lines = [
      `Организация: ${tenant?.name ?? account.inn} · ИНН ${account.inn}`,
      `Проверка: ${e.name}`,
      `Объект: ${e.object || 'не указан'} · вид: ${e.kind}`,
      `Проверяющий: ${e.who || 'не указан'}`,
      `Дата завершения: ${e.finishedAt ?? e.date}`,
      `Результат: пунктов ${e.total}, нарушений ${e.bad}`,
      '',
      ...e.items.map((it, i) => `${i + 1}. ${it.text} — ${it.answer === 'ok' ? 'соответствует' : it.answer === 'bad' ? 'НАРУШЕНИЕ' : 'не отмечено'}${it.answer === 'bad' && it.comment ? ` (${it.comment})` : ''}${it.photoFileId ? ' [фото в системе]' : ''}`),
      '',
      'Проверяющий: ______________________    Ответственный за ВКК: ______________________',
    ];
    return { ok: true, title: `Акт № ${e.actNo}`, body: lines.join('\n') };
  }
}
