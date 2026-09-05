import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export interface StoredCredential { hash: string; wallet: string; type: 'session' | 'api-key'; name: string; preview: string; createdAt: number; expiresAt: number; revokedAt?: number }
export interface State { version: 1; orders: Record<string, any>; idempotency: Record<string, { id: string; fingerprint: string }>; credentials: Record<string, StoredCredential>; cache: Record<string, number> }
export class Store {
  state: State = {version:1,orders:{},idempotency:{},credentials:{},cache:{}};
  constructor(private path?: string) {
    if (path) { try { this.state = JSON.parse(readFileSync(path, 'utf8')); if (this.state.version !== 1) throw new Error('Unsupported store version'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; } }
  }
  save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), {recursive: true, mode:0o700});
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state), {mode:0o600});
    renameSync(tmp, this.path);
  }
}
