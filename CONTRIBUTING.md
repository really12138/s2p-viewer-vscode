# Contributing to S2P Viewer

Thank you for helping improve open RF tooling. Bug reports, compatibility
fixtures, documentation fixes, and focused pull requests are welcome.

## Before opening an issue

- Search existing issues and confirm the problem still occurs on the latest
  release.
- Include the VS Code version, extension version, Touchstone version, frequency
  unit, data format (`RI`/`MA`/`DB`), and matrix format when relevant.
- Reduce data to the smallest synthetic `.s2p` file that reproduces the issue.
- Never upload proprietary measurements, customer data, wafer identifiers,
  internal paths, or PDK content to a public issue.

Security vulnerabilities should follow [SECURITY.md](SECURITY.md), not a public
issue.

## Development setup

Requirements:

- Node.js 22.13 or newer
- npm
- VS Code 1.123 or newer on Windows x64 for the accepted integration target

```powershell
git clone https://github.com/really12138/s2p-viewer-vscode.git
cd s2p-viewer-vscode
npm ci
npm run check
npm test
npm run build
```

If a Webview dependency changes, regenerate and review its distributable
license notices with `npm run notices:generate`. The test suite fails when the
checked-in notice no longer matches the production bundle.

The integration suite downloads VS Code 1.123.0 by default:

```powershell
npm run test:integration
```

To reuse a local executable, first confirm `code --version` reports 1.123.0,
then set `S2P_VIEWER_VSCODE_EXECUTABLE` as documented in the README.

## Test fixtures

All committed Touchstone fixtures must be synthetic, small, and redistributable
under this repository's MIT license. A fixture should exercise one documented
syntax or regression and must not be derived from confidential hardware data.

Parser and RF changes require literal, independently derived expected values.
Webview changes should test observable behavior rather than implementation
details. Bug fixes should include a regression that fails before the fix.

## Pull requests

Keep each pull request focused. Before opening it, run:

```powershell
npm run check
npm test
npm run build
npm run test:integration
```

Explain the user-visible behavior, tests performed, documentation impact, and
whether any new dependency or message boundary is introduced. Do not include
generated `dist`, `.vscode-test`, coverage, real measurement, or PDK files.

By contributing, you agree that your contribution is licensed under the MIT
License in [LICENSE](LICENSE).
