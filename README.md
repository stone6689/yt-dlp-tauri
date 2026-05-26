<h1 align="center">yt-dlp-tauri</h1>

<p align="center">
  <strong>A minimal Windows desktop downloader powered by yt-dlp and Tauri 2.</strong>
</p>

<p align="center">
  <a href="./README_zh.md">中文</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#verification">Verification</a> ·
  <a href="#documentation">Documentation</a>
</p>

<p align="center">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-backend-B7410E?logo=rust" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-typed-3178C6?logo=typescript" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-build-646CFF?logo=vite" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-first-0078D4?logo=windows" />
</p>

---

## What is yt-dlp-tauri?

`yt-dlp-tauri` is a small desktop app for downloading videos with `yt-dlp` without writing command-line options by hand. Paste a video URL, preview the metadata, choose a quality, and download an MP4-friendly file from a focused Windows UI.

The project is Windows-first and local-first. It is not a hosted downloader service, does not provide multi-user accounts, and is not affiliated with `yt-dlp`, FFmpeg, Deno, or Tauri.

## Features

- Parse video metadata through `yt-dlp` and preview title, thumbnail, duration, source URL, description, and quality options.
- Download with live progress, speed, ETA, cancellation, and a saved output folder.
- Install, repair, and verify the app-managed Windows toolchain from Settings.
- Verify tools against fixed source URLs and SHA-256 hashes from a pinned manifest.
- Switch the UI between English and Chinese.
- Check GitHub Releases for app updates, with optional `gh-proxy` routing for update and release access.
- Keep local operational logs for recent app activity.

## Tech Stack

| Layer | Choice |
| --- | --- |
| Desktop runtime | Tauri 2 |
| Backend | Rust |
| Frontend | Vanilla TypeScript, Vite |
| UI | Fixed-size product-style desktop interface |
| Toolchain | App-managed Windows `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`, `deno.exe` |
| Installer | NSIS bundle target |

## Quick Start

Use Windows for real app builds. WSL can run many checks, but release installers should be built on Windows with the MSVC Rust toolchain.

### 1. Install prerequisites

- Windows 10/11
- WebView2 Runtime
- Node.js 20+ or 22+
- Rust stable with the MSVC toolchain
- PowerShell 5+ or PowerShell 7+

### 2. Install dependencies

```powershell
npm ci
```

### 3. Optional: restore development tools

```powershell
.\scripts\download-tools.ps1
```

This is optional for normal app use. If tools are missing, open the app, go to Settings, and click `Install tools`.

### 4. Run the desktop app in development

```powershell
npm run tauri dev
```

### 5. Build the Windows installer

```powershell
npm run tauri build
```

The configured bundle target is `nsis`. Build output is written under:

```text
src-tauri\target\release\bundle\nsis\
```

## Configuration

| Item | Purpose |
| --- | --- |
| `src-tauri/tools-manifest.json` | Fixed tool versions, source URLs, target names, and SHA-256 hashes. |
| `src-tauri/tauri.conf.json` | Tauri app metadata, fixed window size, bundle target, icons, and resources. |
| `scripts/download-tools.ps1` | Optional development script that restores the pinned `win-x64` toolchain into the checkout. |
| Settings: output folder | User-facing download directory selection, save, reset, and open actions. |
| Settings: GitHub site | `Direct` or `gh-proxy` mode for update checks and release links. Project home always opens GitHub directly. |

Current release scope:

- Populated tool target: `win-x64`.
- Planned manifest target: `win-arm64`, once every tool URL and hash is pinned.
- Tool binaries are not committed to the repository.

## Data, Storage, and Output

Downloaded videos default to:

```text
%USERPROFILE%\Downloads\yt-dlp-tauri\
```

App state and logs are stored under:

```text
%LOCALAPPDATA%\yt-dlp-tauri\state\
%LOCALAPPDATA%\yt-dlp-tauri\logs\app.log
```

Installed app tools are written under:

```text
%LOCALAPPDATA%\yt-dlp-tauri\Tools\win-x64\
```

Development checkout tools can live at:

```text
src-tauri\Tools\win-x64\yt-dlp\yt-dlp.exe
src-tauri\Tools\win-x64\ffmpeg\bin\ffmpeg.exe
src-tauri\Tools\win-x64\ffmpeg\bin\ffprobe.exe
src-tauri\Tools\win-x64\deno\deno.exe
```

## Verification

Frontend tests:

```powershell
npm test
```

Frontend build:

```powershell
npm run build
```

Rust backend tests:

```powershell
cargo test --manifest-path .\src-tauri\Cargo.toml --lib
```

Rust backend check:

```powershell
cargo check --manifest-path .\src-tauri\Cargo.toml
```

Full Tauri build:

```powershell
npm run tauri build
```

## Documentation

- [Changelog](./CHANGELOG.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Third-party notices](./THIRD-PARTY-NOTICES.md)
- [Tool manifest](./src-tauri/tools-manifest.json)

## Release Checklist

Before publishing a release:

1. Run the verification commands above.
2. Build the NSIS installer on Windows.
3. Confirm `src-tauri/tools-manifest.json` uses fixed release URLs, not `latest`.
4. Confirm generated folders and restored tools are not staged.
5. Include the GPL license and third-party notices with the release.

## Legal

This project is licensed under GPL-3.0. The app downloads and uses third-party command-line tools with their own licenses and redistribution obligations. See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

This project is not affiliated with `yt-dlp`, FFmpeg, Deno, or Tauri.
