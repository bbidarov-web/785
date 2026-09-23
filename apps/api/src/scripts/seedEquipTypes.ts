/**
 * Начальные данные миграции — типы оборудования (SERVER.md §7). В отличие от
 * `seedChecklists`/`seedStageDocs`, конкретный список типов оборудования и
 * периодичность форм в прочитанных фрагментах прототипа не встретился как
 * готовый каталог (только использование уже выданных позиций) — это рабочая
 * реконструкция по смыслу README «Оборудование и журналы», а не копия текста
 * прототипа. Методист правит и дополняет каталог через `/panel`.
 *
 * Запуск: docker compose exec api node dist/scripts/seedEquipTypes.js
 * Идемпотентен: пишет только если канал 'equip_types' ещё пуст.
 */
import { getPrismaClient } from '../infra/prisma/client.js';
import { PrismaChannelStore } from '../infra/prisma/channelStore.js';
import type { EquipmentType } from '../shared/channelShapes.js';

const SEED: EquipmentType[] = [
  {
    key: 'fridge', name: 'Холодильник фармацевтический',
    logs: [{ name: 'Журнал термометрии холодильного оборудования', freq: '2 раза в день', kind: 'журнал' }],
  },
  {
    key: 'sterilizer', name: 'Стерилизатор',
    logs: [
      { name: 'Журнал контроля стерилизации', freq: 'каждый цикл', kind: 'журнал' },
      { name: 'Чек-лист аудита стерилизационной', freq: '1 раз в месяц', kind: 'чек-лист' },
    ],
  },
  {
    key: 'bactericidal_lamp', name: 'Бактерицидная лампа / рециркулятор',
    logs: [{ name: 'Журнал учёта работы бактерицидных ламп', freq: 'ежедневно', kind: 'журнал' }],
  },
];

async function main() {
  const prisma = getPrismaClient();
  const store = new PrismaChannelStore(prisma);
  const current = await store.get<EquipmentType[]>('platform', null, 'equip_types', []);
  if (current.data.length) {
    console.log(`Канал 'equip_types' уже содержит ${current.data.length} типов — пропускаю.`);
    await prisma.$disconnect();
    return;
  }
  const res = await store.set('platform', null, 'equip_types', SEED, { expectedVersion: 0, updatedBy: null });
  if (!res.ok) throw new Error('Не удалось записать начальный каталог типов оборудования — конфликт версий');
  console.log(`Записано ${SEED.length} типов оборудования (версия ${res.version}).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
