# OFFVAULT — Technical Documentation

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Data Model](#3-data-model)
4. [State Management](#4-state-management)
5. [Encryption Specification](#5-encryption-specification)
6. [File Formats](#6-file-formats)
7. [Import / Export Pipeline](#7-import--export-pipeline)
8. [Security Considerations](#8-security-considerations)
9. [Build & Deployment](#9-build--deployment)

---

## 1. Architecture Overview

OFFVAULT is a single-page Angular application. All data lives in the user's browser — there are no API calls, no backend, and no authentication layer.

```
Browser
  └─ Angular SPA (standalone components, signals, OnPush)
       ├─ PasswordService  ←──→  localStorage  (key: "passlock_entries")
       └─ Web Crypto API   ←──→  AES-256-GCM + PBKDF2
```

**Key design decisions:**

- `ChangeDetectionStrategy.OnPush` everywhere — components only re-render when signals change
- All state is held in Angular signals; derived state uses `computed()`
- Lazy-loaded routes keep the initial bundle small
- The `xlsx` library is dynamically imported (`import('xlsx')`) only when a spreadsheet operation is triggered — it never loads on page load

---

## 2. Project Structure

```
src/
  app/
    app.config.ts          — Angular application config (providers, router)
    app.routes.ts          — Route definitions
    app.ts                 — Root component (hosts <router-outlet>)
    models/
      password-entry.model.ts   — PasswordEntry interface
    pages/
      landing/             — Landing / marketing page
      vault/               — Main vault page (CRUD + IO)
      guide/               — Built-in user guide
    services/
      password.ts          — PasswordService (localStorage read/write)
```

### Routes

| Path | Component | Notes |
|---|---|---|
| `/` | `Landing` | Marketing page |
| `/vault` | `Vault` | Main password manager |
| `/guide` | `Guide` | Built-in user guide |
| `**` | redirect → `/` | Catch-all |

---

## 3. Data Model

### `PasswordEntry`

```typescript
interface PasswordEntry {
  id: string;           // crypto.randomUUID()
  key: string;          // e.g. email address, username, site name
  password: string;     // plaintext (protected only at the storage layer)
  description: string;  // optional free-text label
  source?: 'imported';  // set on entries loaded from an import
  createdAt: Date;
  updatedAt: Date;
}
```

### `localStorage` schema

All entries are serialised as a single JSON array under one key:

```
localStorage["passlock_entries"] = JSON.stringify(PasswordEntry[])
```

No other keys are written to `localStorage`.

---

## 4. State Management

The `PasswordService` holds the canonical `entries` signal. The `Vault` component derives all UI state from it using computed signals and local signals.

### Key signals in `Vault`

| Signal | Type | Purpose |
|---|---|---|
| `entries` | `Signal<PasswordEntry[]>` | Canonical list (from service) |
| `filteredEntries` | `computed()` | Entries filtered by `searchQuery` |
| `searchQuery` | `signal('')` | Real-time search string |
| `editingIds` | `signal<Set<string>>` | IDs of rows currently being edited |
| `draftValues` | `signal<Map<string, EditState>>` | In-progress field values per row |
| `pendingRows` | `signal<PendingRow[]>` | New rows not yet committed |
| `showPasswords` | `signal<Set<string>>` | IDs of rows with visible password |
| `ioExportEncrypted` | `signal(true)` | Whether export requires encryption |
| `activeImportSource` | `signal<...>` | Tracks the last imported file for quick re-save |
| `hasUnsavedChanges` | `computed()` | True when vault differs from last saved snapshot |

### Search

```typescript
filteredEntries = computed(() => {
  const q = this.searchQuery().toLowerCase().trim();
  if (!q) return this.entries();
  return this.entries().filter(
    e => e.key.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
  );
});
```

---

## 5. Encryption Specification

OFFVAULT uses standard Web Crypto API primitives. No third-party cryptography libraries are involved in encryption.

### Algorithm

| Parameter | Value |
|---|---|
| Cipher | AES-256-GCM |
| Key derivation | PBKDF2 |
| Hash (PBKDF2) | SHA-256 |
| Iterations | 100,000 |
| Salt length | 16 bytes (random per export) |
| IV length | 12 bytes (random per export) |
| Encoded output | Base64 |

### Effective key derivation (dual-key)

```
effectiveKey = masterPassword + '\x00' + secretKey
```

The null byte (`\x00`) acts as a separator to prevent concatenation collisions (e.g. `"ab" + "c"` ≠ `"a" + "bc"`).

Both the Master Password and Secret Key are required at import time. Legacy files (header `PASSLOCK_ENCRYPTED_V1`) used the Secret Key alone — OFFVAULT detects legacy files automatically and skips the Master Password requirement for backward compatibility.

### Encrypt function (pseudocode)

```
salt  = random(16 bytes)
iv    = random(12 bytes)
key   = PBKDF2(effectiveKey, salt, 100000, SHA-256) → AES-256-GCM key
cipher= AES-256-GCM.encrypt(plaintext, key, iv)
output= base64(salt || iv || cipher)
```

### Decrypt function (pseudocode)

```
raw   = base64decode(input)
salt  = raw[0..15]
iv    = raw[16..27]
cipher= raw[28..]
key   = PBKDF2(effectiveKey, salt, 100000, SHA-256) → AES-256-GCM key
plain = AES-256-GCM.decrypt(cipher, key, iv)
```

---

## 6. File Formats

### `.passlock` (encrypted, default)

```
OFV_SYNC_V1
<base64-encoded encrypted CSV>
```

Line 1 is the file header (used to detect file type without decrypting). Line 2 is the encrypted payload. The CSV payload once decrypted has columns: `key,password,description,createdAt,updatedAt`.

### `.passlock` (xlsx variant, encrypted)

```
OFV_SYNC_XLSX_V1
<base64-encoded encrypted XLSX>
```

The XLSX spreadsheet is built in-memory, base64-encoded, then encrypted as above.

### `.csv` (raw or encrypted wrapper)

**Raw export:** standard comma-separated text with the header row `key,password,description,createdAt,updatedAt`. No encryption.

**Encrypted:** same format as `.passlock` but exported with a `.csv` extension — the file header `OFV_SYNC_V1` is still present on line 1 so OFFVAULT can auto-detect it on import.

### `.xlsx` (raw or encrypted)

**Raw export:** spreadsheet with columns Key, Password, Description, Created, Updated. Built using the `xlsx` (SheetJS) library.

**Encrypted:** the binary XLSX buffer is base64-encoded and encrypted, then wrapped in the `OFV_SYNC_XLSX_V1` header.

### Legacy file detection

On import, OFFVAULT peeks at the first 30 bytes of the file:

| Header found | Action |
|---|---|
| `OFV_SYNC_V1` | New encrypted passlock/csv — require Secret Key + Master Password |
| `OFV_SYNC_XLSX_V1` | New encrypted xlsx — require Secret Key + Master Password |
| `PASSLOCK_ENCRYPTED_V1` | Legacy passlock/csv — require Secret Key only |
| `PASSLOCK_ENCRYPTED_XLSX_V1` | Legacy xlsx — require Secret Key only |
| Anything else | Treat as raw CSV or XLSX |

---

## 7. Import / Export Pipeline

### Export

```
User clicks Export
  → openExportModal()
  → User selects Format (passlock / csv / xlsx) + Protection (Encrypted / Raw)
  → submitIoModal() → handleExport()
    ├── [Encrypted] buildExportContent(format, secretKey, masterPassword)
    │     → derive effectiveKey
    │     → build CSV or XLSX blob
    │     → encryptText(content, effectiveKey)
    │     → prepend header
    │     → downloadFile()
    └── [Raw] build CSV or XLSX directly → downloadFile() / downloadBinary()
```

### Import

```
User selects file
  → onFileSelected() / pickFileWithFsAccess()
  → peek first 30 bytes → detect header
  → set ioIsEncryptedFile, ioIsLegacyFile
  → submitIoModal() → handleImport()
    ├── [Encrypted file]
    │     → read secretKey, masterPassword (if not legacy)
    │     → derive effectiveKey
    │     → decryptText(payload, effectiveKey)
    │     → parse CSV / XLSX → PasswordEntry[]
    │     → passwordService.add() for each
    │     → set activeImportSource (for quick save-back)
    └── [Raw file]
          → parse CSV / XLSX → PasswordEntry[]
          → passwordService.add() for each
```

### Quick Save (File System Access API)

When a file was opened via `showOpenFilePicker()`, OFFVAULT stores the `FileSystemFileHandle`. After any edit to the vault, the "Save to file" button appears. Clicking it writes back to the original file without prompting — no download, no new file. This works in Chrome/Edge. Browsers without the File System Access API fall back to a standard download.

---

## 8. Security Considerations

### Strengths

- **No network attack surface** — zero HTTP requests; CSP `default-src 'self'` is safe to apply
- **Web Crypto API only** — uses browser-native primitives, no third-party crypto code paths
- **Random salt + IV per export** — brute-force and rainbow-table attacks against exported files are infeasible
- **100k PBKDF2 iterations** — slows down offline dictionary attacks on captured export files
- **Dual-key encryption** — two independent secrets must be compromised for an export to be decrypted
- **`"private": true` in `package.json`** — prevents accidental npm publish

### Known limitations

| Issue | Detail | Mitigation |
|---|---|---|
| Passwords stored in plaintext in localStorage | Protected only by the browser same-origin policy | Acceptable trade-off for an offline-only tool; advise users to encrypt exports before sharing |
| `xlsx` library HIGH severity (CVE: GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) | Prototype Pollution + ReDoS; `fixAvailable: false` | Library is lazy-imported and only processes user-selected local files — no remote or untrusted input. No upstream npm fix available as of the last audit. |
| No clipboard-clear timeout | Copied passwords remain in clipboard | Low risk for a local tool; add `setTimeout(() => navigator.clipboard.writeText(''), 30000)` if desired |

### Recommended deployment headers

```
Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: clipboard-write=self
```

---

## 9. Build & Deployment

### Development

```bash
npm install
ng serve          # dev server at http://localhost:4200
```

### Production build

```bash
ng build
```

Output: `dist/offvault/browser/`. All assets are hashed. Angular uses `index.html` as the entry point. For SPA routing to work, the server must redirect all `404` responses to `index.html`.

### Static hosting examples

**Netlify** — add `_redirects`:
```
/*  /index.html  200
```

**Apache** — add `.htaccess`:
```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ /index.html [L]
```

**Nginx:**
```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```
