import { createHash, randomUUID } from 'node:crypto';
import type { FileStorage } from '../../domain/ports.js';

export class InMemoryFileStorage implements FileStorage {
  private files = new Map<string, { tenantInn: string; contentType: string; data: Buffer; checksum: string }>();

  async save(tenantInn: string, contentType: string, data: Buffer): Promise<{ id: string; sizeBytes: number; checksum: string }> {
    const id = randomUUID();
    const checksum = createHash('sha256').update(data).digest('hex');
    this.files.set(id, { tenantInn, contentType, data, checksum });
    return { id, sizeBytes: data.byteLength, checksum };
  }

  async read(tenantInn: string, id: string): Promise<{ contentType: string; data: Buffer; checksum: string } | null> {
    const row = this.files.get(id);
    if (!row || row.tenantInn !== tenantInn) return null;
    return { contentType: row.contentType, data: row.data, checksum: row.checksum };
  }
}
