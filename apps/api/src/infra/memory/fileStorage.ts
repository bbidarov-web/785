import { randomUUID } from 'node:crypto';
import type { FileStorage } from '../../domain/ports.js';

export class InMemoryFileStorage implements FileStorage {
  private files = new Map<string, { tenantInn: string; contentType: string; data: Buffer }>();

  async save(tenantInn: string, contentType: string, data: Buffer): Promise<{ id: string; sizeBytes: number }> {
    const id = randomUUID();
    this.files.set(id, { tenantInn, contentType, data });
    return { id, sizeBytes: data.byteLength };
  }

  async read(tenantInn: string, id: string): Promise<{ contentType: string; data: Buffer } | null> {
    const row = this.files.get(id);
    if (!row || row.tenantInn !== tenantInn) return null;
    return { contentType: row.contentType, data: row.data };
  }
}
