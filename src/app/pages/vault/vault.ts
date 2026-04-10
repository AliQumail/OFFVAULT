import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PasswordService } from '../../services/password';
import { PasswordEntry } from '../../models/password-entry.model';

const PASSLOCK_HEADER = 'PASSLOCK_ENCRYPTED_V1';

interface EditState {
  key: string;
  password: string;
  description: string;
}

interface PendingRow {
  tmpId: string;
  key: string;
  password: string;
  description: string;
}

@Component({
  selector: 'app-vault',
  imports: [FormsModule, RouterLink],
  templateUrl: './vault.html',
  styleUrl: './vault.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Vault {
  private readonly passwordService = inject(PasswordService);

  entries = this.passwordService.entries;
  editingIds = signal<Set<string>>(new Set());
  draftValues = signal<Map<string, EditState>>(new Map());
  pendingRows = signal<PendingRow[]>([]);
  showPasswords = signal<Set<string>>(new Set());

  /** Max characters allowed in key / password / description fields. Edit this to change all inputs at once. */
  readonly maxFieldLength = 75;

  // Delete confirmation
  deleteConfirmId = signal<string | null>(null);

  // Import/Export modal
  ioModalOpen = signal(false);
  ioModalMode = signal<'import' | 'export'>('export');
  ioSecretKey = signal('');
  ioSelectedFile = signal<File | null>(null);
  ioIsEncryptedFile = signal(false);
  ioError = signal('');
  ioProcessing = signal(false);
  ioExportFormat = signal<'passlock' | 'csv' | 'xlsx'>('passlock');

  // ── Inline editing ──────────────────────────────────────────────────────────

  isEditing(id: string): boolean {
    return this.editingIds().has(id);
  }

  getDraft(id: string): EditState | undefined {
    return this.draftValues().get(id);
  }

  startEdit(entry: PasswordEntry): void {
    this.editingIds.update(s => new Set([...s, entry.id]));
    this.draftValues.update(m => new Map([...m, [entry.id, { key: entry.key, password: entry.password, description: entry.description }]]));
  }

  cancelEdit(id: string): void {
    this.editingIds.update(s => { const n = new Set(s); n.delete(id); return n; });
    this.draftValues.update(m => { const n = new Map(m); n.delete(id); return n; });
  }

  saveEdit(id: string): void {
    const draft = this.draftValues().get(id);
    if (!draft || !draft.key.trim() || !draft.password.trim()) return;
    this.passwordService.update(id, {
      key: draft.key.trim(),
      password: draft.password.trim(),
      description: draft.description.trim(),
    });
    this.cancelEdit(id);
  }

  updateDraft(id: string, field: keyof EditState, value: string): void {
    this.draftValues.update(m => {
      const n = new Map(m);
      const current = n.get(id) ?? { key: '', password: '', description: '' };
      n.set(id, { ...current, [field]: value });
      return n;
    });
  }

  addPendingRow(): void {
    this.pendingRows.update(rows => [
      ...rows,
      { tmpId: crypto.randomUUID(), key: '', password: '', description: '' },
    ]);
  }

  savePendingRow(tmpId: string): void {
    const row = this.pendingRows().find(r => r.tmpId === tmpId);
    if (!row || !row.key.trim() || !row.password.trim()) return;
    this.passwordService.add({
      key: row.key.trim(),
      password: row.password.trim(),
      description: row.description.trim(),
    });
    this.pendingRows.update(rows => rows.filter(r => r.tmpId !== tmpId));
  }

  removePendingRow(tmpId: string): void {
    this.pendingRows.update(rows => rows.filter(r => r.tmpId !== tmpId));
  }

  updatePendingRow(tmpId: string, field: keyof Omit<PendingRow, 'tmpId'>, value: string): void {
    this.pendingRows.update(rows =>
      rows.map(r => (r.tmpId === tmpId ? { ...r, [field]: value } : r))
    );
  }

  // ── Delete with confirmation ────────────────────────────────────────────────

  requestDelete(id: string): void {
    this.deleteConfirmId.set(id);
  }

  confirmDelete(): void {
    const id = this.deleteConfirmId();
    if (id) {
      this.passwordService.delete(id);
      this.cancelEdit(id);
    }
    this.deleteConfirmId.set(null);
  }

  cancelDeleteConfirm(): void {
    this.deleteConfirmId.set(null);
  }

  // ── Password utilities ──────────────────────────────────────────────────────

  togglePasswordVisibility(id: string): void {
    this.showPasswords.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  isPasswordVisible(id: string): boolean {
    return this.showPasswords().has(id);
  }

  generatePassword(context: { id?: string; tmpId?: string }): void {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
    const array = new Uint32Array(20);
    crypto.getRandomValues(array);
    const password = Array.from(array, v => chars[v % chars.length]).join('');
    if (context.id) {
      this.updateDraft(context.id, 'password', password);
    } else if (context.tmpId) {
      this.updatePendingRow(context.tmpId, 'password', password);
    }
  }

  copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text);
  }

  // ── Import / Export ─────────────────────────────────────────────────────────

  openExportModal(): void {
    this.ioModalMode.set('export');
    this.ioSecretKey.set('');
    this.ioError.set('');
    this.ioProcessing.set(false);
    this.ioExportFormat.set('passlock');
    this.ioModalOpen.set(true);
  }

  openImportModal(): void {
    this.ioModalMode.set('import');
    this.ioSecretKey.set('');
    this.ioSelectedFile.set(null);
    this.ioIsEncryptedFile.set(false);
    this.ioError.set('');
    this.ioProcessing.set(false);
    this.ioModalOpen.set(true);
  }

  closeIoModal(): void {
    if (this.ioProcessing()) return;
    this.ioModalOpen.set(false);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.ioSelectedFile.set(file);
    this.ioIsEncryptedFile.set(file?.name.toLowerCase().endsWith('.passlock') ?? false);
    this.ioError.set('');
  }

  submitIoModal(): void {
    if (this.ioModalMode() === 'export') {
      this.handleExport();
    } else {
      this.handleImport();
    }
  }

  async handleExport(): Promise<void> {
    const format = this.ioExportFormat();
    this.ioProcessing.set(true);
    this.ioError.set('');
    try {
      if (format === 'passlock') {
        const secretKey = this.ioSecretKey().trim();
        if (!secretKey) { this.ioError.set('Please enter a secret key.'); this.ioProcessing.set(false); return; }
        const csv = this.buildCsv(this.entries());
        const encrypted = await this.encryptText(csv, secretKey);
        this.downloadFile(`${PASSLOCK_HEADER}\n${encrypted}`, 'vault-export.passlock', 'text/plain');
      } else if (format === 'csv') {
        const csv = this.buildCsv(this.entries());
        this.downloadFile(csv, 'vault-export.csv', 'text/csv');
      } else {
        const data = await this.buildXlsx();
        this.downloadBinary(data, 'vault-export.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      }
      this.ioModalOpen.set(false);
    } catch {
      this.ioError.set('Export failed. Please try again.');
    } finally {
      this.ioProcessing.set(false);
    }
  }

  async handleImport(): Promise<void> {
    const file = this.ioSelectedFile();
    if (!file) { this.ioError.set('Please select a file.'); return; }
    this.ioProcessing.set(true);
    this.ioError.set('');
    try {
      const name = file.name.toLowerCase();
      let csvContent: string;

      if (this.ioIsEncryptedFile()) {
        const secretKey = this.ioSecretKey().trim();
        if (!secretKey) { this.ioError.set('Please enter the secret key.'); this.ioProcessing.set(false); return; }
        const text = await file.text();
        const nl = text.indexOf('\n');
        if (nl === -1 || text.slice(0, nl).trim() !== PASSLOCK_HEADER) {
          this.ioError.set('Invalid PassLock file.'); this.ioProcessing.set(false); return;
        }
        csvContent = await this.decryptText(text.slice(nl + 1).trim(), secretKey);
      } else if (name.endsWith('.csv')) {
        csvContent = await file.text();
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        csvContent = await this.xlsxToCsv(file);
      } else {
        this.ioError.set('Unsupported format. Use .passlock, .csv, or .xlsx'); this.ioProcessing.set(false); return;
      }

      const parsed = this.parseCsv(csvContent);
      if (parsed.length === 0) { this.ioError.set('No valid entries found in file.'); this.ioProcessing.set(false); return; }
      const existingKeys = new Set(this.entries().map(e => e.key.trim().toLowerCase()));
      const newEntries = parsed.filter(e => !existingKeys.has(e.key.trim().toLowerCase()));
      if (newEntries.length === 0) { this.ioError.set('All entries already exist in your vault (matched by key). Nothing was imported.'); this.ioProcessing.set(false); return; }
      newEntries.forEach(e => this.passwordService.add({ ...e, source: 'imported' }));
      this.ioModalOpen.set(false);
    } catch {
      this.ioError.set(
        this.ioIsEncryptedFile()
          ? 'Decryption failed. Check your secret key and try again.'
          : 'Failed to parse file. Check the format and try again.'
      );
    } finally {
      this.ioProcessing.set(false);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildCsv(entries: PasswordEntry[]): string {
    const rows: string[][] = [['key', 'password', 'description']];
    for (const e of entries) {
      rows.push([this.csvField(e.key), this.csvField(e.password), this.csvField(e.description)]);
    }
    return rows.map(r => r.join(',')).join('\n');
  }

  private parseCsv(csv: string): Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'>[] {
    const lines = csv.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    const start = lines[0].toLowerCase().includes('key') ? 1 : 0;
    return lines.slice(start)
      .map(line => {
        const [key = '', password = '', description = ''] = this.parseCsvLine(line);
        if (!key.trim() || !password.trim()) return null;
        return { key: key.trim(), password: password.trim(), description: description.trim() };
      })
      .filter((e): e is Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'> => e !== null);
  }

  private csvField(v: string): string {
    return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; }
      } else if (c === ',' && !inQ) {
        result.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur);
    return result;
  }

  private async xlsxToCsv(file: File): Promise<string> {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
  }

  private downloadFile(content: string, name: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async buildXlsx(): Promise<ArrayBuffer> {
    const XLSX = await import('xlsx');
    const data = [
      ['key', 'password', 'description'],
      ...this.entries().map(e => [e.key, e.password, e.description]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vault');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  }

  private downloadBinary(data: ArrayBuffer, name: string, type: string): void {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
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
