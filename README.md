# OFFVAULT

A completely offline, browser-based password manager with AES-256-GCM encryption. No servers, no accounts, no tracking — your passwords never leave your device.

<img width="731" height="416" alt="image" src="https://github.com/user-attachments/assets/eefbbcdf-20e5-4edf-893e-916a3eccaf85" />


## Features

- **100% Offline** — all data is stored in browser `localStorage`, no network calls ever made
- **Zero data collection** — no telemetry, no accounts, no sign-up required
- **AES-256-GCM encryption** — exports protected with PBKDF2 key derivation (100,000 iterations, SHA-256)
- **Dual-key security** — Secret Key + Master Password both required to decrypt exported files
- **Multiple export formats** — encrypted `.passlock`, `.csv`, or `.xlsx`; raw (unencrypted) export also available
- **Real-time search** — filter entries instantly by key or description
- **Password generator** — generate strong passwords with one click
- **User Guide** — built-in help guide at `/guide`

## Getting Started

```bash
npm install
ng serve
```

Open `http://localhost:4200` in your browser. No configuration needed.

## Build

```bash
ng build
```

Output is written to `dist/`. Production build is the default — output hashing and size budgets are enabled.

## Security Model

- Passwords are stored as plaintext in `localStorage` (protected by the browser's same-origin policy)
- Exported files are encrypted with AES-256-GCM using a key derived from `masterPassword + '\x00' + secretKey` via PBKDF2
- All cryptographic operations use the native **Web Crypto API** — no third-party crypto libraries
- See [doc/TECHNICAL.md](doc/TECHNICAL.md) for full architecture and encryption specification

## Development

```bash
ng test     # unit tests via Vitest
ng e2e      # end-to-end tests (framework not included by default)
```

## Tech Stack

- **Angular 21** — standalone components, signals, `OnPush` change detection
- **Tailwind CSS v4** — utility-first styling via PostCSS
- **Web Crypto API** — AES-256-GCM + PBKDF2 (built into the browser)
- **xlsx** — spreadsheet import/export (lazy-loaded, user-triggered only)
