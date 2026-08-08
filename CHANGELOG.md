# Changelog

All notable changes to S2P Viewer are documented here.

## [0.1.0] - 2026-08-08

### Added

- Default read-only VS Code preview for `.s2p` and `.S2P` files.
- Touchstone 1.x, 2.0, and 2.1 parsing for two-port S parameters in `RI`, `MA`,
  and `DB` formats across Hz/kHz/MHz/GHz units.
- Smith charts for S11/S22 and magnitude dB plots for S12/S21.
- Combined and S-matrix four-grid layouts with remembered preference.
- Comparison sessions for 2–10 files from a picker or Explorer multi-selection.
- Per-file color, visibility, removal, retry, and isolated error handling.
- Synchronized nearest-sample hover/locked cursor with complex, phase, dB, and
  impedance readouts.
- Shared dB frequency zoom, Auto, Reset, unsaved-document reload, external file
  watching, and parsed-data caching.
- Offline CSP-locked Webview, runtime-validated messages, deterministic VSIX,
  VS Code Electron integration tests, and a real-directory parser benchmark.

### Fixed

- Made locked-cursor status text use high-contrast VS Code theme tokens.
- Prevented failed or stale Plotly generations from reporting successful load
  metrics.
- Stabilized reflection-to-impedance conversion for finite near-open and very
  large reflection coefficients.

### Known limitations

- Two-port S parameters only; no editing, de-embedding, calibration,
  passivity/causality analysis, export, or noise-parameter plotting.
- Maximum ten files per comparison session.
- Windows x64 with VS Code 1.123+ is the accepted 0.1.0 platform.

[0.1.0]: https://github.com/really12138/s2p-viewer-vscode/releases/tag/v0.1.0
