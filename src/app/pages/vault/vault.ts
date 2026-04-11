import { Component, inject, signal, computed, ChangeDetectionStrategy, viewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PasswordService, ImportSource } from '../../services/password';
import { PasswordEntry } from '../../models/password-entry.model';

const PASSLOCK_HEADER = 'OFV_SYNC_V1';
const PASSLOCK_XLSX_HEADER = 'OFV_SYNC_XLSX_V1';
const LEGACY_HEADER = 'PASSLOCK_ENCRYPTED_V1';
const LEGACY_XLSX_HEADER = 'PASSLOCK_ENCRYPTED_XLSX_V1';

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

  // Tooltip
  tooltipText = signal('');
  tooltipPos = signal({ x: 0, y: 0 });
  tooltipVisible = signal(false);

  showTooltip(text: string, event: MouseEvent): void {
    if (!text) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(8, Math.min(rect.left, window.innerWidth - 340));
    this.tooltipText.set(text);
    this.tooltipPos.set({ x, y: rect.bottom + 10 });
    this.tooltipVisible.set(true);
  }

  hideTooltip(): void {
    this.tooltipVisible.set(false);
  }

  /** Max characters allowed in key / password / description fields. Edit this to change all inputs at once. */
  readonly maxFieldLength = 50;

  // Delete confirmation
  deleteConfirmId = signal<string | null>(null);

  // Reset vault confirmation
  resetVaultConfirmOpen = signal(false);

  // Mobile more-menu dropdown
  moreMenuOpen = signal(false);
  toggleMoreMenu(): void { this.moreMenuOpen.update(v => !v); }
  closeMoreMenu(): void { this.moreMenuOpen.set(false); }

  // Import/Export modal
  private readonly ioFileInputRef = viewChild<ElementRef<HTMLInputElement>>('ioFileInput');
  ioModalOpen = signal(false);
  ioModalMode = signal<'import' | 'export'>('export');
  ioSecretKey = signal('');
  ioSelectedFile = signal<File | null>(null);
  ioIsEncryptedFile = signal(false);
  ioError = signal('');
  ioProcessing = signal(false);
  ioExportFormat = signal<'passlock' | 'csv' | 'xlsx'>('passlock');
  ioMasterPassword = signal('');
  ioIsLegacyFile = signal(false);
  ioExportEncrypted = signal(true);
  searchQuery = signal('');

  // Delegated to service — persists across navigation
  activeImportSource = this.passwordService.activeImportSource;
  hasUnsavedChanges = this.passwordService.hasUnsavedChanges;
  readonly hasFsAccess = typeof window !== 'undefined' && 'showOpenFilePicker' in window;
  ioSelectedFsHandle = signal<FileSystemFileHandle | null>(null);
  isSaving = signal(false);

  filteredEntries = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.entries();
    return this.entries().filter(
      e => e.key.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    );
  });

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

  requestResetVault(): void {
    this.resetVaultConfirmOpen.set(true);
  }

  confirmResetVault(): void {
    this.passwordService.clearAll();
    this.editingIds.set(new Set());
    this.draftValues.set(new Map());
    this.pendingRows.set([]);
    this.showPasswords.set(new Set());
    this.passwordService.clearImportSource();
    this.resetVaultConfirmOpen.set(false);
  }

  cancelResetVault(): void {
    this.resetVaultConfirmOpen.set(false);
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

  async saveToActiveFile(): Promise<void> {
    const source = this.activeImportSource();
    if (!source || !this.hasUnsavedChanges() || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      const content = await this.buildExportContent(source.format, source.secretKey, source.masterPassword);
      if (source.handle) {
        // Write directly to the original file — no dialog
        const writable = await source.handle.createWritable();
        await writable.write(content);
        await writable.close();
      } else if (this.hasFsAccess) {
        // First save via FS API — one-time dialog, then store handle for future saves
        const ext = source.format === 'passlock' ? 'passlock' : source.format;
        const newHandle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
          suggestedName: source.fileName,
          types: [{ description: 'Vault file', accept: { 'text/plain': [`.${ext}`] } }],
        });
        const writable = await newHandle.createWritable();
        await writable.write(content);
        await writable.close();
        this.passwordService.updateImportSourceHandle(newHandle);
      } else {
        // Fallback: download with same filename
        this.downloadFile(content, source.fileName, 'text/plain');
      }
      this.passwordService.markSaved();
    } catch (e: unknown) {
      // Ignore AbortError (user cancelled the save dialog)
    } finally {
      this.isSaving.set(false);
    }
  }

  openExportModal(): void {
    this.ioModalMode.set('export');
    this.ioSecretKey.set('');
    this.ioMasterPassword.set('');
    this.ioError.set('');
    this.ioProcessing.set(false);
    this.ioExportFormat.set('passlock');
    this.ioExportEncrypted.set(true);
    this.ioModalOpen.set(true);
  }

  setExportEncrypted(encrypted: boolean): void {
    this.ioExportEncrypted.set(encrypted);
    if (!encrypted && this.ioExportFormat() === 'passlock') {
      this.ioExportFormat.set('csv');
    }
  }

  openImportModal(): void {
    this.ioModalMode.set('import');
    this.ioSecretKey.set('');
    this.ioMasterPassword.set('');
    this.ioSelectedFile.set(null);
    this.ioSelectedFsHandle.set(null);
    this.ioIsEncryptedFile.set(false);
    this.ioIsLegacyFile.set(false);
    this.ioError.set('');
    this.ioProcessing.set(false);
    this.ioModalOpen.set(true);
  }

  closeIoModal(): void {
    if (this.ioProcessing()) return;
    this.ioModalOpen.set(false);
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.ioSelectedFile.set(file);
    this.ioSelectedFsHandle.set(null); // regular input — no FS handle available
    this.ioError.set('');
    if (file) {
      const peek = await file.slice(0, 30).text();
      const isLegacy = peek.startsWith(LEGACY_HEADER) || peek.startsWith(LEGACY_XLSX_HEADER);
      this.ioIsEncryptedFile.set(
        peek.startsWith(PASSLOCK_HEADER) || peek.startsWith(PASSLOCK_XLSX_HEADER) || isLegacy
      );
      this.ioIsLegacyFile.set(isLegacy);
    } else {
      this.ioIsEncryptedFile.set(false);
      this.ioIsLegacyFile.set(false);
    }
  }

  resetIoModal(): void {
    this.ioSelectedFile.set(null);
    this.ioSelectedFsHandle.set(null);
    this.ioSecretKey.set('');
    this.ioMasterPassword.set('');
    this.ioError.set('');
    this.ioIsEncryptedFile.set(false);
    this.ioIsLegacyFile.set(false);
    const input = this.ioFileInputRef()?.nativeElement;
    if (input) input.value = '';
  }

  async pickFileWithFsAccess(): Promise<void> {
    try {
      const [handle]: FileSystemFileHandle[] = await (window as any).showOpenFilePicker({
        types: [{ description: 'Vault files', accept: { 'text/plain': ['.passlock', '.csv', '.xlsx'] } }],
        multiple: false,
      });
      const file = await handle.getFile();
      this.ioSelectedFsHandle.set(handle);
      this.ioSelectedFile.set(file);
      this.ioError.set('');
      const peek = await file.slice(0, 30).text();
      const isLegacy = peek.startsWith(LEGACY_HEADER) || peek.startsWith(LEGACY_XLSX_HEADER);
      this.ioIsEncryptedFile.set(
        peek.startsWith(PASSLOCK_HEADER) || peek.startsWith(PASSLOCK_XLSX_HEADER) || isLegacy
      );
      this.ioIsLegacyFile.set(isLegacy);
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        this.ioError.set('Failed to open file.');
      }
    }
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
    const isEncrypted = this.ioExportEncrypted();

    if (isEncrypted) {
      const secretKey = this.ioSecretKey().trim();
      const masterPassword = this.ioMasterPassword().trim();
      if (!secretKey) { this.ioError.set('Please enter a secret key.'); return; }
      if (!masterPassword) { this.ioError.set('Please enter a master password.'); return; }
      this.ioProcessing.set(true);
      this.ioError.set('');
      try {
        const content = await this.buildExportContent(format, secretKey, masterPassword);
        const ext = format === 'passlock' ? 'passlock' : format;
        this.downloadFile(content, `vault-export.${ext}`, 'text/plain');
        this.ioModalOpen.set(false);
      } catch {
        this.ioError.set('Export failed. Please try again.');
      } finally {
        this.ioProcessing.set(false);
      }
    } else {
      // Raw (unprotected) export
      this.ioProcessing.set(true);
      this.ioError.set('');
      try {
        if (format === 'xlsx') {
          const buffer = await this.buildXlsx();
          this.downloadBinary(buffer, 'vault-export.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        } else {
          const csv = this.buildCsv(this.entries());
          this.downloadFile(csv, 'vault-export.csv', 'text/csv');
        }
        this.ioModalOpen.set(false);
      } catch {
        this.ioError.set('Export failed. Please try again.');
      } finally {
        this.ioProcessing.set(false);
      }
    }
  }

  private async buildExportContent(format: 'passlock' | 'csv' | 'xlsx', secretKey: string, masterPassword: string): Promise<string> {
    const effectiveKey = masterPassword + '\x00' + secretKey;
    if (format === 'xlsx') {
      const xlsxData = await this.buildXlsx();
      const base64 = this.toBase64(new Uint8Array(xlsxData));
      const encrypted = await this.encryptText(base64, effectiveKey);
      return `${PASSLOCK_XLSX_HEADER}\n${encrypted}`;
    }
    const csv = this.buildCsv(this.entries());
    const encrypted = await this.encryptText(csv, effectiveKey);
    return `${PASSLOCK_HEADER}\n${encrypted}`;
  }

  async handleImport(): Promise<void> {
    const file = this.ioSelectedFile();
    if (!file) { this.ioError.set('Please select a file.'); return; }

    // Block importing a different file when one is already active
    const current = this.activeImportSource();
    if (current && current.fileName.toLowerCase() !== file.name.toLowerCase()) {
      this.ioError.set(`A file is already imported ("${current.fileName}"). Reset your vault first or re-import the same file.`);
      return;
    }
    this.ioProcessing.set(true);
    this.ioError.set('');
    try {
      const name = file.name.toLowerCase();
      let csvContent: string;

      if (this.ioIsEncryptedFile()) {
        const secretKey = this.ioSecretKey().trim();
        if (!secretKey) { this.ioError.set('Please enter the secret key.'); this.ioProcessing.set(false); return; }
        const isLegacy = this.ioIsLegacyFile();
        const masterPassword = this.ioMasterPassword().trim();
        if (!isLegacy && !masterPassword) { this.ioError.set('Please enter the master password.'); this.ioProcessing.set(false); return; }
        const effectiveKey = isLegacy ? secretKey : masterPassword + '\x00' + secretKey;
        const text = await file.text();
        const nl = text.indexOf('\n');
        if (nl === -1) { this.ioError.set('Invalid encrypted file.'); this.ioProcessing.set(false); return; }
        const fileHeader = text.slice(0, nl).trim();
        const payload = text.slice(nl + 1).trim();
        if (fileHeader === PASSLOCK_HEADER || fileHeader === LEGACY_HEADER) {
          csvContent = await this.decryptText(payload, effectiveKey);
        } else if (fileHeader === PASSLOCK_XLSX_HEADER || fileHeader === LEGACY_XLSX_HEADER) {
          const decrypted = await this.decryptText(payload, effectiveKey);
          const buffer = this.fromBase64(decrypted).buffer as ArrayBuffer;
          csvContent = await this.xlsxBufferToCsv(buffer);
        } else {
          this.ioError.set('Invalid encrypted file.'); this.ioProcessing.set(false); return;
        }
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

      // Track the import source for one-click sync
      const importedFormat: 'passlock' | 'csv' | 'xlsx' =
        name.endsWith('.passlock') ? 'passlock' :
        (name.endsWith('.xlsx') || name.endsWith('.xls')) ? 'xlsx' : 'csv';
      this.passwordService.setImportSource({
        fileName: file.name,
        format: importedFormat,
        secretKey: this.ioSecretKey().trim(),
        masterPassword: this.ioMasterPassword().trim(),
        isLegacy: this.ioIsLegacyFile(),
        handle: this.ioSelectedFsHandle(),
      });

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
        return {
          key: key.trim().slice(0, this.maxFieldLength),
          password: password.trim().slice(0, this.maxFieldLength),
          description: description.trim().slice(0, this.maxFieldLength),
        };
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

  private async xlsxBufferToCsv(buffer: ArrayBuffer): Promise<string> {
    const XLSX = await import('xlsx');
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
