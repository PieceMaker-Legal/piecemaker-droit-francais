# PieceMaker public npm distribution

The package is scoped to the `PieceMaker-Legal` npm organization and is
configured for the public npm registry:

```text
@piecemaker-legal/piecemaker
https://registry.npmjs.org
```

Users do not need a GitHub token to install the public package.

The package also has an additive GitHub Packages release path:

```text
@piecemaker-legal/piecemaker
https://npm.pkg.github.com
```

Install from that registry with:

```bash
npm install -g @piecemaker-legal/piecemaker --registry=https://npm.pkg.github.com
piecemaker
```

## Publish and install

After authenticating to npm as a maintainer, publish the package with:

```bash
npm publish
```

Publish to GitHub Packages with the dedicated release script:

```bash
npm login --scope=@piecemaker-legal --auth-type=legacy --registry=https://npm.pkg.github.com
PUBLISH=1 PUSH=1 npm run package:github:release
```

The package must then be set to **Public** in the GitHub package settings.
GitHub requires maintainer authentication to publish; this repository does not
request or store a token.

Users can then install it globally and start the local Node backend:

```bash
npm install -g @piecemaker-legal/piecemaker
piecemaker
```

The package's `dependencies` are installed by npm. Node.js 22 or newer is
required. The browser PWA is served by the backend at `http://localhost:3001`.

PieceMaker is based on [CloudCLI UI](https://github.com/siteboon/claudecodeui).
The published package includes this attribution and retains the upstream
AGPL-3.0-or-later licensing obligations.

## Inspect without publishing

```bash
npm pack --dry-run
```

This shows the files that would be included in the package without creating or
uploading a release.
