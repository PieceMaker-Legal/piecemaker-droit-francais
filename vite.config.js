import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { getConnectableHost, normalizeLoopbackHost } from './shared/networkHosts.js'
import { createWebManifest, loadProductConfig } from './shared/product-config.mjs'

// The client shows the installed package version so it can be compared against the
// version the server process is actually running. Reading package.json here and
// injecting it keeps the frontend free of imports that reach outside src/.
const pkg = createRequire(import.meta.url)('./package.json')
const product = loadProductConfig()

function escapeTemplateValue(value) {
  return JSON.stringify(value).slice(1, -1)
}

function createProductPwaPlugin() {
  const manifestSource = `${JSON.stringify(createWebManifest(product), null, 2)}\n`
  const serviceWorkerTemplate = readFileSync(new URL('./pwa/service-worker.js', import.meta.url), 'utf8')
  const serviceWorkerSource = serviceWorkerTemplate
    .replaceAll('__PWA_CACHE_NAME__', `${product.slug}-pwa-v${pkg.version}`)
    .replaceAll('__PRODUCT_NAME__', escapeTemplateValue(product.name))

  return {
    name: 'product-pwa-assets',
    transformIndexHtml(html) {
      return html
        .replaceAll('%PRODUCT_PAGE_TITLE%', product.pageTitle)
        .replaceAll('%PRODUCT_SHORT_NAME%', product.shortName)
        .replaceAll('%PRODUCT_THEME_COLOR%', product.themeColor)
        .replaceAll('%PRODUCT_BACKGROUND_COLOR%', product.backgroundColor)
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/manifest.json') {
          response.setHeader('Content-Type', 'application/manifest+json')
          response.end(manifestSource)
          return
        }
        if (request.url === '/sw.js') {
          response.setHeader('Content-Type', 'text/javascript')
          response.setHeader('Service-Worker-Allowed', '/')
          response.end(serviceWorkerSource)
          return
        }
        next()
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: manifestSource })
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const configuredHost = env.HOST || '0.0.0.0'
  // if the host is not a loopback address, it should be used directly. 
  // This allows the vite server to EXPOSE all interfaces when the host 
  // is set to '0.0.0.0' or '::', while still using 'localhost' for browser 
  // URLs and proxy targets.
  const host = normalizeLoopbackHost(configuredHost)
  
  const proxyHost = getConnectableHost(configuredHost)
  // TODO: Remove support for legacy PORT variables in all locations in a future major release, leaving only SERVER_PORT.
  const serverPort = env.SERVER_PORT || env.PORT || 3001

  return {
    plugins: [react(), createProductPwaPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __PRODUCT_NAME__: JSON.stringify(product.name),
      __PRODUCT_SHORT_NAME__: JSON.stringify(product.shortName),
      __PRODUCT_PAGE_TITLE__: JSON.stringify(product.pageTitle),
      __PRODUCT_REPOSITORY__: JSON.stringify(product.repository),
      __PRODUCT_REPOSITORY_URL__: JSON.stringify(product.repositoryUrl)
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      host,
      port: parseInt(env.VITE_PORT) || 5173,
      proxy: {
        '/api': `http://${proxyHost}:${serverPort}`,
        '/ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/shell': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/plugin-ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl']
          }
        }
      }
    }
  }
})
