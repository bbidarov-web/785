import { randomUUID } from 'node:crypto';
import type { Clock, SecondHandRepo } from '../../domain/ports.js';
import type { SecondHandRequest, SecondHandStatus } from '../../domain/types.js';

export class InMemorySecondHandRepo implements SecondHandRepo {
  private rows: SecondHandRequest[] = [];
  constructor(private clock: Clock) {}

  async create(req: Omit<SecondHandRequest, 'id' | 'requestedAt' | 'status' | 'confirmedById' | 'confirmedAt'>): Promise<SecondHandRequest> {
    const row: SecondHandRequest = {
      ...req,
      id: 'shr_' + randomUUID(),
      requestedAt: this.clock.now(),
      status: 'pending',
      confirmedById: null,
      confirmedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async findById(id: string): Promise<SecondHandRequest | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async listPending(): Promise<SecondHandRequest[]> {
    return this.rows.filter((r) => r.status === 'pending').sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
  }

  async setStatus(id: string, status: SecondHandStatus, confirmedById: string | null): Promise<SecondHandRequest> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error('Запрос не найден');
    row.status = status;
    row.confirmedById = confirmedById;
    row.confirmedAt = status === 'confirmed' || status === 'rejected' ? this.clock.now() : null;
    return row;
  }
}
