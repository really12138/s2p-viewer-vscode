# Security Policy

## Supported versions

Security fixes are provided for the latest published `0.1.x` release. Users
should reproduce reports on the newest available version before submitting.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use GitHub's private
security advisory form:

https://github.com/really12138/s2p-viewer-vscode/security/advisories/new

Include the affected version, impact, minimal reproduction, and any suggested
mitigation. Do not attach proprietary Touchstone or PDK data; use a synthetic
fixture or describe how maintainers can construct one.

Relevant security boundaries include malicious Touchstone input, parser denial
of service, path/URI handling, extension-to-Webview message validation, CSP and
HTML escaping, unintended file modification, and unexpected network access.

The maintainer will acknowledge the report, validate it privately, and
coordinate disclosure and a fixed release when the report is confirmed. No
response-time or bounty commitment is made by this volunteer project.
