import { Injectable, signal, computed } from '@angular/core';
import { PasswordEntry } from '../models/password-entry.model';

const STORAGE_KEY = 'passlock_vault';
const SESSION_VAULT_KEY = 'passlock_vault_key';

export interface ImportSource {
  fileName: string;
  format: 'offvault' | 'csv' | 'xlsx';
  secretKey: string;
  masterPassword: string;
  handle: FileSystemFileHandle | null;
}

@Injectable({
  providedIn: 'root',
})
export class PasswordService {
  readonly entries = signal<PasswordEntry[]>([]);
  private vaultKey!: string;

  constructor() {
    const stored = sessionStorage.getItem(SESSION_VAULT_KEY);
    if (stored) {
      this.vaultKey = stored;
    } else {
      this.vaultKey = this.generateSessionKey();
      sessionStorage.setItem(SESSION_VAULT_KEY, this.vaultKey);
    }
  }

  private generateSessionKey(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  // Import source tracking — lives in service so it persists across navigation
  readonly activeImportSource = signal<ImportSource | null>(null);
  private readonly savedEntriesSnapshot = signal('');

  private readonly currentEntriesSnapshot = computed(() =>
    this.entries().map(e => `${e.key}\x00${e.password}\x00${e.description}`).join('\n')
  );

  readonly hasUnsavedChanges = computed(() => {
    if (!this.activeImportSource()) return false;
    return this.currentEntriesSnapshot() !== this.savedEntriesSnapshot();
  });

  setImportSource(source: ImportSource): void {
    this.activeImportSource.set(source);
    this.savedEntriesSnapshot.set(this.currentEntriesSnapshot());
  }

  markSaved(): void {
    this.savedEntriesSnapshot.set(this.currentEntriesSnapshot());
  }

  clearImportSource(): void {
    this.activeImportSource.set(null);
    this.savedEntriesSnapshot.set('');
  }

  updateImportSourceHandle(handle: FileSystemFileHandle): void {
    this.activeImportSource.update(s => s ? { ...s, handle } : null);
  }

  async loadFromStorage(): Promise<void> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const json = await this.decryptText(raw, this.vaultKey);
      this.entries.set(JSON.parse(json) as PasswordEntry[]);
    } catch {
      // Key mismatch (different session) — discard stale encrypted blob
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  async persistVaultKey(key: string): Promise<void> {
    this.vaultKey = key;
    sessionStorage.setItem(SESSION_VAULT_KEY, key);
    await this.saveToStorage();
  }

  private scheduleSave(): void {
    void this.saveToStorage();
  }

  private async saveToStorage(): Promise<void> {
    const json = JSON.stringify(this.entries());
    const encrypted = await this.encryptText(json, this.vaultKey);
    localStorage.setItem(STORAGE_KEY, encrypted);
  }

  add(entry: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'>): void {
    const now = new Date();
    const newEntry: PasswordEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.entries.update((list) => [newEntry, ...list]);
    this.scheduleSave();
  }

  update(id: string, changes: Partial<Pick<PasswordEntry, 'key' | 'password' | 'description'>>): void {
    this.entries.update((list) =>
      list.map((e) => (e.id === id ? { ...e, ...changes, updatedAt: new Date() } : e))
    );
    this.scheduleSave();
  }

  delete(id: string): void {
    this.entries.update((list) => list.filter((e) => e.id !== id));
    this.scheduleSave();
  }

  clearAll(): void {
    this.entries.set([]);
    this.vaultKey = this.generateSessionKey();
    sessionStorage.setItem(SESSION_VAULT_KEY, this.vaultKey);
    localStorage.removeItem(STORAGE_KEY);
  }

  private async deriveKey(secretKey: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const km = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secretKey), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
      km,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private async encryptText(plaintext: string, key: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ck = await this.deriveKey(key, salt);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, new TextEncoder().encode(plaintext))
    );
    const out = new Uint8Array(28 + ct.byteLength);
    out.set(salt, 0); out.set(iv, 16); out.set(ct, 28);
    return this.toBase64(out);
  }

  private async decryptText(encoded: string, key: string): Promise<string> {
    const buf = this.fromBase64(encoded);
    const ck = await this.deriveKey(key, buf.slice(0, 16) as Uint8Array<ArrayBuffer>);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf.slice(16, 28) as Uint8Array<ArrayBuffer> }, ck, buf.slice(28)
    );
    return new TextDecoder().decode(pt);
  }

  private toBase64(data: Uint8Array): string {
    let s = '';
    for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
    return btoa(s);
  }

  private fromBase64(b64: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }
}
