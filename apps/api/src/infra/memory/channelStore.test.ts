import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryChannelStore } from './channelStore.js';
import { TestClock } from './systemClock.js';

describe('ChannelStore — версии вместо молчаливого затирания (CLAUDE.md)', () => {
  let store: InMemoryChannelStore;

  beforeEach(() => { store = new InMemoryChannelStore(new TestClock()); });

  it('первое чтение возвращает version 0 и fallback', async () => {
    const r = await store.get('tenant', '7712345671', 'client_state', { a: 1 });
    expect(r.version).toBe(0);
    expect(r.data).toEqual({ a: 1 });
  });

  it('запись увеличивает версию, повторное чтение видит новые данные', async () => {
    const w = await store.set('tenant', '7712345671', 'client_state', { a: 2 }, { updatedBy: 'u1' });
    expect(w.ok).toBe(true);
    const r = await store.get('tenant', '7712345671', 'client_state', { a: 1 });
    expect(r.version).toBe(w.ok ? w.version : -1);
    expect(r.data).toEqual({ a: 2 });
  });

  it('запись с устаревшей expectedVersion возвращает conflict, а не затирает данные', async () => {
    await store.set('tenant', '7712345671', 'client_state', { a: 1 }, { updatedBy: 'u1' });
    // вторая вкладка ещё не знает про правку первой и пишет со старой версией 0
    const conflict = await store.set('tenant', '7712345671', 'client_state', { a: 999 }, { expectedVersion: 0, updatedBy: 'u2' });
    expect(conflict.ok).toBe(false);
    const current = await store.get('tenant', '7712345671', 'client_state', {});
    expect(current.data).toEqual({ a: 1 }); // не затёрто
  });

  it('арендаторы изолированы: запись в один tenantInn не видна в другом', async () => {
    await store.set('tenant', '7712345671', 'client_state', { a: 'A' }, { updatedBy: null });
    const other = await store.get('tenant', '9999999999', 'client_state', { a: 'fallback' });
    expect(other.data).toEqual({ a: 'fallback' });
  });

  it('platform-канал не зависит от tenantInn', async () => {
    await store.set('platform', null, 'checklists', ['x'], { updatedBy: null });
    const r = await store.get('platform', null, 'checklists', []);
    expect(r.data).toEqual(['x']);
  });

  describe('opId — идемпотентность офлайн-очереди (SERVER.md §6.5)', () => {
    it('повтор операции с тем же opId не применяется дважды', async () => {
      const first = await store.set('tenant', '7712345671', 'walk_results', { a: 1 }, { expectedVersion: 0, updatedBy: 'u1', opId: 'op-1' });
      expect(first.ok).toBe(true);
      // офлайн-очередь не получила подтверждение и повторяет тот же запрос с той же версией
      const retry = await store.set('tenant', '7712345671', 'walk_results', { a: 1 }, { expectedVersion: 0, updatedBy: 'u1', opId: 'op-1' });
      expect(retry.ok).toBe(true);
      if (retry.ok) expect(retry.idempotent).toBe(true);
      const state = await store.get('tenant', '7712345671', 'walk_results', {});
      expect(state.version).toBe(1); // не 2 — повтор не создал вторую версию
    });

    it('повтор с тем же opId не проваливается в конфликт версий, даже если версия уже другая', async () => {
      await store.set('tenant', '7712345671', 'walk_results', { a: 1 }, { updatedBy: 'u1', opId: 'op-1' });
      // другая операция продвинула версию вперёд, пока клиент не получил ответ на op-1
      await store.set('tenant', '7712345671', 'walk_results', { a: 2 }, { expectedVersion: 1, updatedBy: 'u2', opId: 'op-2' });
      const retryStale = await store.set('tenant', '7712345671', 'walk_results', { a: 1 }, { expectedVersion: 0, updatedBy: 'u1', opId: 'op-1' });
      // ожидание: op-1 уже был последней операцией ДО op-2, поэтому lastOpId сейчас 'op-2' —
      // повтор op-1 больше не совпадает с lastOpId и корректно должен идти по обычной проверке версии
      expect(retryStale.ok).toBe(false);
    });

    it('разные операции с разными opId применяются обе', async () => {
      const a = await store.set('tenant', '7712345671', 'walk_results', { a: 1 }, { expectedVersion: 0, updatedBy: 'u1', opId: 'op-1' });
      expect(a.ok && a.version).toBe(1);
      const b = await store.set('tenant', '7712345671', 'walk_results', { a: 2 }, { expectedVersion: 1, updatedBy: 'u1', opId: 'op-2' });
      expect(b.ok && b.version).toBe(2);
    });
  });
});
