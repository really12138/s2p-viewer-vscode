# S2P Viewer

[![CI](https://github.com/really12138/s2p-viewer-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/really12138/s2p-viewer-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[简体中文](README.zh-CN.md)

Open an `.s2p` file and inspect two-port S-parameters directly in VS Code.
Compare 2–10 related measurements or simulations without uploading RF data or
leaving the editor.

![S2P Viewer four-grid preview](docs/images/overview.png)

## What it does

- Opens `.s2p` and `.S2P` files in a read-only custom editor.
- Draws S11/S22 on Smith charts and S12/S21 as magnitude in dB.
- Switches between a combined comparison and an S-matrix four-grid layout.
- Compares 2–10 files with per-file colors, visibility, removal, and errors.
- Synchronizes hover and locked markers at each file's nearest real frequency
  sample, with complex, phase, dB, and reflection-impedance readouts.

Use it for measured vs. simulated data, raw vs. de-embedded results, or any
related set of two-port files.

![Comparing S2P files](docs/images/comparison.gif)

## Install

[Download `s2p-viewer-0.1.0.vsix` from the v0.1.0 release](https://github.com/really12138/s2p-viewer-vscode/releases/tag/v0.1.0),
then run:

```powershell
code --install-extension ".\s2p-viewer-0.1.0.vsix" --force
```

Requires VS Code 1.123 or newer. For a source build, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Use

1. Click an `.s2p` file in Explorer; **S2P Preview** opens automatically.
2. Add files from the toolbar, or select several `.s2p` files in Explorer and
   choose **Compare S2P Files** from the context menu.
3. Hover a trace for its nearest sample. Click to lock the synchronized cursor;
   click again or press `Escape` to release it.

Use **Reopen Editor With → Text Editor** when you need the raw Touchstone text.
**Auto** rescales active plots, **Reset** restores ranges, and **File** opens the
comparison-file controls.

## Supported input

- Touchstone 1.x, 2.0, and 2.1 two-port S-parameter data
- `Hz`, `kHz`, `MHz`, and `GHz`; `RI`, `MA`, and `DB`
- Full, lower, and upper Touchstone 2.x matrices
- Global or per-port reference impedances
- UTF-8/ASCII, comments, wrapped records, and scientific notation

Noise sections are recognized but not plotted. Malformed or unsupported input
gets a structured error without hiding other valid comparison files.

## Privacy and current limits

S2P Viewer is read-only and runs locally. It has no telemetry, CDN, network
service, local server, or Python/MATLAB dependency. Do not attach proprietary
measurement or PDK data to a public issue; use a synthetic reproducer instead.

Version 0.1.0 does not edit, de-embed, calibrate, convert network parameters,
perform passivity/causality analysis, plot noise parameters, export data, or
open non-two-port `.sNp` files. A comparison is limited to ten files.

## Project

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) ·
[Architecture](docs/architecture.md) · [Changelog](CHANGELOG.md) ·
[Third-party notices](THIRD_PARTY_NOTICES.md)

## License

S2P Viewer is released under the [MIT License](LICENSE).
