# PieceMaker

PieceMaker is a browser/PWA interface backed by a local Node.js server.

## Install

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/scripts/piecemaker/cli/piecemaker.sh | sh && piecemaker
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/scripts/piecemaker/cli/piecemaker.ps1 | iex; piecemaker
```

This installs Node.js (via nvm) if it is not already present, clones or updates the repository, installs the `piecemaker` command, and launches the PWA in a standalone Chrome/Edge/Brave/Chromium app window. No prerequisites required.

## Install from GitHub Packages

The same package can also be published publicly to GitHub Packages:

```bash
npm install -g @piecemaker-legal/piecemaker --registry=https://npm.pkg.github.com
piecemaker
```

GitHub Packages uses a separate registry from npmjs. Maintainers need GitHub
publishing credentials; no credential is stored in this repository.

## Build and test the package locally

```bash
npm ci
npm run build
npm pack
npm install -g ./piecemaker-1.37.2.tgz
```

## Attribution

PieceMaker is a French-law-focused fork of [CloudCLI UI](https://github.com/siteboon/claudecodeui), the open-source web interface for Claude Code, Cursor CLI, and Codex. It retains the upstream CloudCLI architecture and licensing while adding PieceMaker-specific branding and legal-work features.

The package is licensed under AGPL-3.0-or-later. Upstream CloudCLI notices and license terms remain applicable to the corresponding code.

## Regenerate the package

From a clean checkout, this pulls the latest fast-forwardable commits from
`origin`, increments the patch version, builds the client and server, and
creates a package archive under `release/npm/`:

```bash
npm run package:release
```

Use `minor`, `major`, or an explicit version instead of `patch` when needed:

```bash
npm run package:release -- minor
npm run package:release -- 1.38.0
```

Publishing and pushing the version bump are explicit:

```bash
PUBLISH=1 PUSH=1 npm run package:release
```

`PUBLISH=1` publishes to the public npm registry using the maintainer's local
npm authentication. The script never creates or stores credentials.

To publish through GitHub Packages instead:

```bash
npm run package:github:release
PUBLISH=1 PUSH=1 npm run package:github:release
```
