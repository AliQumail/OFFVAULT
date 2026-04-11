import { Injectable, signal } from '@angular/core';
import { PasswordEntry } from '../models/password-entry.model';

const STORAGE_KEY = 'passlock_entries';

@Injectable({
  providedIn: 'root',
})
export class PasswordService {
  readonly entries = signal<PasswordEntry[]>(this.load());

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
