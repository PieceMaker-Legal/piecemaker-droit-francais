# Building a branded fork

This repository can produce two clients from the same React and Node codebase:

- an installable PWA served by the Node backend;
- the existing Electron desktop app for macOS and Windows.

Both targets read their identity from the root [`product.config.json`](../product.config.json). The checked-in values reproduce CloudCLI, so make the identity changes below before distributing a fork.

## 1. Keep the canonical repository connected

After creating your GitHub fork, use your fork as `origin` and retain the real CloudCLI repository as `upstream`. This checkout already has the canonical `upstream` remote; replace only the `origin` URL once your fork exists:

```bash
git remote set-url origin git@github.com:YOUR_ACCOUNT/YOUR_REPOSITORY.git
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/siteboon/claudecodeui.git
git remote set-url --push upstream DISABLED
git fetch --all --prune
git remote -v
```

Before starting feature work, bring in every canonical update on a temporary integration branch:

```bash
git fetch upstream --prune
git switch main
git merge --ff-only upstream/main
git push origin main
git switch -c product/upstream-$(date +%Y%m%d)
```

If your branded `main` contains product commits and cannot fast-forward, merge upstream explicitly instead:

```bash
git switch main
git fetch upstream --prune
git merge --no-ff upstream/main
npm ci
npm run typecheck
npm test
npm run test:client
npm run build
git push origin main
```

Never replace the upstream remote with a copy or periodically download ZIP files. A permanent `upstream` remote preserves commit ancestry, makes missing updates visible, and gives Git enough history to resolve recurring merges.

## 2. Give the fork its own identity

Edit `product.config.json` once. At minimum, change:

```json
{
  "name": "Your Product",
  "shortName": "Your Product",
  "pageTitle": "Your Product",
  "slug": "your-product",
  "appId": "com.yourcompany.yourproduct",
  "protocol": "yourproduct",
  "dataDirectoryName": ".your-product",
  "homepage": "https://your-product.example",
  "repository": "YOUR_ACCOUNT/YOUR_REPOSITORY",
  "controlPlaneUrl": "https://your-product.example",
  "sshHost": "ssh.your-product.example"
}
```

These values drive the browser/PWA metadata, primary frontend branding, Electron bundle identity, deep-link protocol, artifact names, local-server bundle names, GitHub links, and desktop runtime download URL.

Use values that are unique to the fork:

- `appId` prevents macOS and Windows from treating the fork as CloudCLI.
- `protocol` prevents deep-link registration conflicts.
- `dataDirectoryName` places the database, attachments, browser profiles, server runtime, and marker in a separate home-directory folder.
- `repository` makes Electron download matching local-server bundles from your fork's GitHub Releases.

Replace the assets in `public/` and `electron/assets/` before distribution. Run `npm run desktop:icon:mac` after replacing the source macOS icon. Some translated text still names CloudCLI and can be customized incrementally under `src/modules/i18n/locales/`.

## 3. Develop and build the PWA

Install Node.js 22 and dependencies:

```bash
npm ci
npm run pwa:dev
```

The development UI is at `http://localhost:5173`; it proxies API and WebSocket traffic to the backend on port 3001.

For a production-like build:

```bash
npm run pwa:build
npm run server
```

Open `http://localhost:3001`. `pwa:build` compiles both the web client and the required Node backend. The build emits `manifest.json` and `sw.js` from the product config. Outside localhost, browsers require HTTPS for installation, service workers, notifications, and most PWA capabilities.

The PWA is a client, not a server replacement. The Node backend must run on a machine with access to the workspaces and CLI providers. A static-only host can display cached assets but cannot provide chat sessions, files, Git, terminals, MCP configuration, or authentication.

## 4. Develop and build the desktop app

Run the web/backend development processes and Electron together in separate terminals:

```bash
npm run dev
npm run desktop:dev
```

Create an unpacked local desktop build without looking for a signing identity:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:pack
```

Create a macOS DMG:

```bash
npm run desktop:dist:mac -- --publish never
```

Public macOS distribution requires your own Developer ID Application certificate and Apple notarization credentials. The checked-in desktop workflows expect `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` secrets. Windows distribution similarly requires your own code-signing setup.

## 5. Publish the matching desktop runtime

Thin desktop packages download a version- and architecture-matched backend from the repository configured in `product.config.json`. Build it with:

```bash
npm run server:bundle
```

Upload both files from `release/local-server/` (the `.tar.gz` and `.sha256`) to the GitHub release tag written to `electron/server-bundle-config.json` for that desktop build. The standard release workflows create that tag and upload the pair automatically. A desktop build will fail safely if the asset is missing or its checksum differs.

You can temporarily override the configured source while testing:

```bash
CLOUDCLI_SERVER_BUNDLE_URL=https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY/releases/download npm run desktop:dev
```

## 6. License and release checklist

CloudCLI is licensed under AGPL-3.0-or-later. If users interact with your modified version over a network, provide the complete corresponding source for that running version, including your modifications and build instructions. Keep copyright and license notices, and review the license with counsel for commercial distribution.

Before each release:

```bash
git fetch upstream --prune
git log --oneline HEAD..upstream/main
npm ci
npm run typecheck
npm run lint
npm test
npm run test:client
npm run pwa:build
CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:pack
```

An empty `git log HEAD..upstream/main` means the release contains every commit currently present on canonical `upstream/main`.
