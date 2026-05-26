# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## 0.1.2 - 2026-05-26

- Added GitHub release notes generation from the matching `CHANGELOG.md` version section.
- Finished the video metadata progress text after successful or failed parsing.
- Improved GitHub update check errors for API rate limits with reset-time guidance.
- Fixed Bilibili thumbnail previews by suppressing referrers on remote cover images.

## 0.1.1 - 2026-05-26

- Hid background Windows command windows during tool checks, installs, metadata parsing, downloads, extraction, and cancellation.
- Improved tool install, archive extraction, and process failure messages with concrete paths, exit codes, and stderr details.
- Aligned the Settings footer version row with update and project controls.
- Fixed thumbnail previews by normalizing HTTP thumbnail URLs to HTTPS and retrying fallback thumbnail candidates.

## 0.1.0 - 2026-05-26

- Renamed the project to `yt-dlp-tauri`.
- Added automatic current-target toolchain installation.
- Added a simplified desktop UI with English and Chinese language switching.
- Added fixed-version tool manifest entries with SHA-256 verification.
- Added manual GitHub Release update checks.
- Added Direct / gh-proxy routing for update checks and release links.
- Added project metadata and a project home link in Settings.
- Added GitHub-ready README files in English and Chinese.
- Added CI checks for frontend tests, frontend builds, Rust tests, and Rust checks.
