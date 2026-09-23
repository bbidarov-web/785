import type { Clock, ExecutorMarkRepo } from '../../domain/ports.js';

export class InMemoryExecutorMarkRepo implements ExecutorMarkRepo {
  private rows = new Map<string, string>(); // `${accountId}|${itemKey}` -> ISO date
  constructor(private clock: Clock) {}

  async markDone(accountId: string, itemKey: string): Promise<void> {
    this.rows.set(`${accountId}|${itemKey}`, this.clock.now().toISOString().slice(0, 10));
  }

  async listForAccount(accountId: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const prefix = `${accountId}|`;
    for (const [k, v] of this.rows.entries()) {
      // itemKey сам содержит "|" (например "doc|Положение о ВКК") — делить можно
      // только по ПЕРВОМУ разделителю, .split('|') без limit давал обрезанный ключ
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    }
    return out;
  }
}
