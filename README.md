# S2P Viewer

[![CI](https://github.com/really12138/s2p-viewer-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/really12138/s2p-viewer-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[简体中文](README.zh-CN.md)

S2P Viewer is a read-only, offline VS Code extension for quickly reviewing and
comparing two-port Touchstone S-parameter files. It keeps RF data beside the
code, scripts, and model files that use it, without requiring proprietary EDA
software or uploading measurements to a service.

It is designed for everyday RF and device-modeling checks such as measured vs.
simulated, raw vs. de-embedded, and bias/temperature/corner comparisons.

## Features

- Opens `.s2p` and `.S2P` files as the default VS Code custom editor.
- Plots S11 and S22 on Smith charts and S12 and S21 as magnitude in dB.
- Switches between a combined comparison view and an S-matrix four-grid view:
  S11 top-left, S12 top-right, S21 bottom-left, S22 bottom-right.
- Compares 2–10 files from the toolbar picker or Explorer multi-selection.
- Provides per-file colors, visibility, removal, retry, and isolated errors.
- Synchronizes hover and locked markers across all plots using each file's
  nearest real frequency sample, without resampling different grids.
- Reports dB values plus complex, magnitude, phase, and impedance values for
  reflection parameters.
- Reloads unsaved primary-document edits and external comparison-file changes.
- Runs entirely locally with a CSP-locked Webview and bundled Plotly renderer.

## Install

### GitHub release

Download `s2p-viewer-0.1.0.vsix` from the latest GitHub Release, then run:

```powershell
code --install-extension ".\s2p-viewer-0.1.0.vsix" --force
```

### Build from source

Requirements: Node.js 22.13 or newer and VS Code 1.123 or newer.

```powershell
npm ci
npm run package
code --install-extension ".\dist\s2p-viewer-0.1.0.vsix" --force
```

The package command runs type checking, unit/Webview tests, a production build,
and the VS Code Electron integration suite before creating the VSIX.

## Use

Click or open an `.s2p` file to show **S2P Preview**. To inspect or edit the raw
text, use **Reopen Editor With → Text Editor**, run **S2P Viewer: Reopen as
Text** from the Command Palette, or use the text action on a primary-file error.

### Layout and file controls

- **Combined comparison** shows one Smith chart for S11/S22 and one dB chart
  for S21/S12. Line styles distinguish the paired parameters.
- **Four-grid** follows S-matrix reading order: S11, S12, S21, S22.
- **Add Files** opens the VS Code multi-select file picker.
- In Explorer, select `.s2p` files, right-click the intended primary file, and
  choose **Compare S2P Files**.
- **Auto** autoscales active plots. **Reset** clears the synchronized cursor and
  resets ranges.
- **File** opens the comparison panel. Files can be hidden; comparison files
  can also be removed. The primary remains in the session.

The combined dB plots share their frequency zoom. Smith ranges are independent.
The selected layout is remembered across previews.

### Synchronized cursor

Hover a trace to snap to a real frequency sample. Click to lock it; click again
or press `Escape` to unlock. When the readout has keyboard focus, `Left Arrow`
and `Right Arrow` move through primary-file samples. Out-of-range comparison
files are identified instead of extrapolated.

## Supported Touchstone input

- Touchstone 1.x, 2.0, and 2.1 two-port S-parameter data
- `Hz`, `kHz`, `MHz`, and `GHz`
- `RI`, `MA`, and `DB`
- Touchstone 2.x full, lower, and upper matrices and both two-port data orders
- Global or per-port reference impedances
- UTF-8/ASCII, optional UTF-8 BOM, comments, wrapped records, and scientific
  notation

Recognized noise sections are ignored and marked in metadata because noise
parameters are not plotted. Unsupported parameters, malformed records,
non-finite values, non-increasing frequencies, and inconsistent declarations
produce structured errors. One failed comparison does not hide valid files.

## Privacy and safety

S2P Viewer is read-only and does not modify Touchstone files. It has no
telemetry, CDN, network service, Python/MATLAB dependency, local server, or
external runtime. File-system access stays in the VS Code extension host; the
Webview receives normalized numeric data through runtime-validated messages.

Do not attach proprietary measurement or PDK data to a public GitHub issue.
Use a minimal synthetic reproducer whenever possible.

## Known limitations

Version 0.1.0 does not edit Touchstone files; perform de-embedding,
calibration, passivity/causality analysis, or network-parameter conversion;
plot noise parameters; support Y/Z/H/G parameters or non-two-port `.sNp`;
export markers/images/CSV; auto-pair files; analyze more than ten files; or
provide persistent disk caching. Browser and remote extension hosts are not a
compatibility target for this release.

## Development

```powershell
npm ci
npm run check
npm test
npm run build
npm run test:integration
npm run package
```

The integration runner downloads VS Code 1.123.0 by default. To reuse a local
installation that is exactly version 1.123.0:

```powershell
$env:S2P_VIEWER_VSCODE_EXECUTABLE = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
npm run test:integration
```

Run the read-only parser benchmark against representative directories:

```powershell
npm run benchmark -- --raw-dir "C:\path\to\raw" --deembedded-dir "C:\path\to\deembedded" --count 10
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for fixture and pull-request rules,
[SECURITY.md](SECURITY.md) for private vulnerability reporting, and
[docs/architecture.md](docs/architecture.md) for the trust boundaries.

## License

S2P Viewer is released under the [MIT License](LICENSE). Plotly.js attribution
is provided in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
