/**
 * Начальные данные миграции — состав сводного отчёта (SERVER.md §7). Названия
 * и примечания перенесены дословно из запасного состава в
 * `reference/prototype/Обход - мобильный.dc.html` (`_sumSeedFallback`,
 * строки ~1135–1140).
 *
 * Запуск: docker compose exec api node dist/scripts/seedSummaryMaster.js
 * Идемпотентен: пишет только если канал 'summary_master' ещё пуст.
 */
import { getPrismaClient } from '../infra/prisma/client.js';
import { PrismaChannelStore } from '../infra/prisma/channelStore.js';
import type { SummaryRowDef } from '../shared/channelShapes.js';

const SEED: SummaryRowDef[] = [
  { name: 'Сводный отчёт по системе качества за год', note: 'итоги проверок, нарушений и корректирующих действий', req: true },
  { name: 'Аналитическая справка по результатам аудитов', note: 'динамика по направлениям 785н и филиалам', req: true },
  { name: 'Отчёт для врачебной комиссии и руководителя', note: 'выводы и решения по итогам года', req: false },
];

async function main() {
  const prisma = getPrismaClient();
  const store = new PrismaChannelStore(prisma);
  const current = await store.get<SummaryRowDef[]>('platform', null, 'summary_master', []);
  if (current.data.length) {
    console.log(`Канал 'summary_master' уже содержит ${current.data.length} строк — пропускаю.`);
    await prisma.$disconnect();
    return;
  }
  const res = await store.set('platform', null, 'summary_master', SEED, { expectedVersion: 0, updatedBy: null });
  if (!res.ok) throw new Error('Не удалось записать начальный состав сводного отчёта — конфликт версий');
  console.log(`Записано ${SEED.length} строк сводного отчёта (версия ${res.version}).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
