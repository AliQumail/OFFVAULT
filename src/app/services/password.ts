import { Injectable, signal, computed } from '@angular/core';
import { PasswordEntry } from '../models/password-entry.model';

const STORAGE_KEY = 'passlock_entries';

export interface ImportSource {
  fileName: string;
  format: 'passlock' | 'csv' | 'xlsx';
  secretKey: string;
  masterPassword: string;
  isLegacy: boolean;
  handle: FileSystemFileHandle | null;
}

@Injectable({
  providedIn: 'root',
})
export class PasswordService {
  readonly entries = signal<PasswordEntry[]>(this.load());

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

  private load(): PasswordEntry[] {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as PasswordEntry[];
    } catch {
      return [];
    }
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries()));
  }

  add(entry: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'>): void {
    const now = new Date();
    const newEntry: PasswordEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.entries.update((list) => [...list, newEntry]);
    this.save();
  }

  update(id: string, changes: Partial<Pick<PasswordEntry, 'key' | 'password' | 'description'>>): void {
    this.entries.update((list) =>
      list.map((e) => (e.id === id ? { ...e, ...changes, updatedAt: new Date() } : e))
    );
    this.save();
  }

  delete(id: string): void {
    this.entries.update((list) => list.filter((e) => e.id !== id));
    this.save();
  }

  clearAll(): void {
    this.entries.set([]);
    this.save();
  }
}
