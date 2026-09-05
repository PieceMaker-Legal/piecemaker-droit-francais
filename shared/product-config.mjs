import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARED_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(SHARED_DIRECTORY, '..', 'product.config.json');
const REQUIRED_STRING_KEYS = [
  'name',
  'shortName',
  'pageTitle',
  'description',
  'slug',
  'appId',
  'protocol',
  'dataDirectoryName',
  'homepage',
  'repository',
  'controlPlaneUrl',
  'sshHost',
  'themeColor',
  'backgroundColor',
];

function requireSafePathSegment(value, key) {
  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error(`product.config.json ${key} must be a single directory/file-name segment`);
  }
}

/** Reads and validates the product identity shared by web and desktop builds. */
export function loadProductConfig(configPath = process.env.CLOUDCLI_PRODUCT_CONFIG || DEFAULT_CONFIG_PATH) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  for (const key of REQUIRED_STRING_KEYS) {
    if (typeof config[key] !== 'string' || !config[key].trim()) {
      throw new Error(`product.config.json requires a non-empty string for ${key}`);
    }
    config[key] = config[key].trim();
  }

  requireSafePathSegment(config.dataDirectoryName, 'dataDirectoryName');
  requireSafePathSegment(config.slug, 'slug');

  if (!/^[a-z][a-z0-9+.-]*$/.test(config.protocol)) {
    throw new Error('product.config.json protocol must be a valid lowercase URL scheme');
  }

  for (const key of ['homepage', 'controlPlaneUrl']) {
    new URL(config[key]);
  }

  return Object.freeze({
    ...config,
    repositoryUrl: `https://github.com/${config.repository}`,
    serverBundleBaseUrl: `https://github.com/${config.repository}/releases/download`,
  });
}

/** Produces the install metadata emitted as manifest.json by Vite. */
export function createWebManifest(product) {
  return {
    name: product.name,
    short_name: product.shortName,
    description: product.description,
    start_url: '/',
    display: 'standalone',
    background_color: product.backgroundColor,
    theme_color: product.themeColor,
    orientation: 'portrait-primary',
    scope: '/',
    icons: [72, 96, 128, 144, 152, 192, 384, 512].map((size) => ({
      src: `/icons/icon-${size}x${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'maskable any',
    })),
  };
}
