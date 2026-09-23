/**
 * Каналы данных прототипа (SERVER.md §3) — ключи, под которыми в `localStorage`
 * прототипа лежали срезы состояния. На сервере это версионированные строки
 * в таблицах `platform_channel` / `tenant_channel` (см. apps/api/prisma/schema.prisma).
 * Список нужен, чтобы миграция данных пилотных клиник (SERVER.md §8) шла по
 * известному перечню, а не по догадке.
 */

/** Пространство стандарта: издания методиста, общие для всех арендаторов. */
export const PLATFORM_KEYS = [
  'stage_docs', 'checklists', 'blocks_catalog', 'doc_catalogs',
  'block_tpls', 'block_pins', 'required', 'positions',
  'licworks', 'doc_revs', 'cycle_master', 'sheets',
  'admin_state', // рабочее состояние оператора — пишется любой ролью платформы, не только методистом
] as const;

/** Каналы в разрезе арендатора (суффикс `_<ИНН>` в прототипе). */
export const TENANT_CHANNELS = [
  'client_state', 'stagedocs_op', 'blockdocs', 'stage_paid', 'docasg', 'doc_notes',
  'messages', 'msg_ack', 'audit_plan', 'walk_results', 'equip_pos', 'equip_fill', 'selfaudit',
] as const;

export type PlatformChannelKey = (typeof PLATFORM_KEYS)[number];
export type TenantChannelKey = (typeof TENANT_CHANNELS)[number];
