# Architecture - Widget (Embeddable)

> Generated: 2026-02-14 | Part: widget | Type: web

## Overview

The Widget is a **lightweight Preact application** designed to be embedded on customer websites. It builds to a single JavaScript file (`widget.js`) for easy CDN deployment and script tag inclusion.

## Architecture Pattern

**Single-File Embeddable Component**

```
Customer Website
    │
    ▼
┌──────────────────┐
│   <script>        │  Script tag loading widget.js
│   widget.js       │  Single bundled file
└──────┬───────────┘
       ▼
┌──────────────────┐
│   main.tsx        │  ★ Entry point (mount to DOM)
└──────┬───────────┘
       ▼
┌──────────────────┐
│   App.tsx         │  Root widget component
└──────────────────┘
```

## Technology Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| Framework | Preact | 10.26.0 | Lightweight React alternative (~3KB) |
| Bundler | Vite | 6.3.0 | Fast build with HMR |
| Plugin | @preact/preset-vite | 2.10.0 | Preact Vite integration |
| Minifier | Terser | - | Production minification |

## Build Configuration

Key build optimizations in `vite.config.ts`:
- **Target**: ES2020
- **Minification**: Terser with `drop_console` and `drop_debugger`
- **Output**: Single file (`widget.js` + `widget.css`)
- **No code splitting**: `manualChunks: undefined`
- **Base path**: `./` (relative for CDN deployment)
- **Compressed size reporting**: Enabled

## Source Structure

| File | Purpose |
|------|---------|
| `src/main.tsx` | DOM mount point, renders `<App />` |
| `src/App.tsx` | Root widget component |
| `index.html` | Development HTML shell |

## Deployment Strategy

- Built to `dist/widget.js` (single file)
- Intended for CDN hosting
- Customers embed via `<script>` tag
- Self-contained with no external dependencies at runtime

## Current Status

The widget is in **early setup** phase with only the basic Preact scaffold. Feature implementation is planned for future sprints.
