import { randomUUID } from 'node:crypto';
import type { AccountRepo } from '../../domain/ports.js';
import type { Account } from '../../domain/types.js';
import type { Clock } from '../../domain/ports.js';

export class InMemoryAccountRepo implements AccountRepo {
  private rows: Account[] = [];
  constructor(private clock: Clock) {}

  async create(acc: Omit<Account, 'id' | 'createdAt' | 'lastLoginAt' | 'approvedById' | 'approvedAt' | 'passwordChangedAt'>): Promise<Account> {
    const row: Account = {
      ...acc,
      id: 'acc_' + randomUUID(),
      createdAt: this.clock.now(),
      lastLoginAt: null,
      approvedById: null,
      approvedAt: null,
      passwordChangedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async findById(id: string): Promise<Account | null> {
    return this.rows.find((a) => a.id === id) ?? null;
  }

  async findByInnLogin(inn: string, login: string): Promise<Account | null> {
    const l = login.toLowerCase();
    return this.rows.find((a) => a.inn === inn && a.login.toLowerCase() === l) ?? null;
  }

  async findByInnPhone(inn: string, phone: string): Promise<Account | null> {
    return this.rows.find((a) => a.inn === inn && a.phone === phone) ?? null;
  }

  async listPending(): Promise<Account[]> {
    return this.rows.filter((a) => a.pending);
  }

  async update(id: string, patch: Partial<Account>): Promise<Account> {
    const idx = this.rows.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error('Учётная запись не найдена');
    const current = this.rows[idx];
    if (!current) throw new Error('Учётная запись не найдена');
    const updated: Account = { ...current, ...patch };
    this.rows[idx] = updated;
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((a) => a.id !== id);
  }

  /** Только для тестов — прямой доступ к таблице без порта. */
  _seed(acc: Account): void {
    this.rows.push(acc);
  }
}
