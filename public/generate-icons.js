import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const logoSizes = [32, 64, 128, 256, 512];
const iconSizes = [72, 96, 128, 144, 152, 192, 384, 512];
const outputDirectory = path.dirname(fileURLToPath(import.meta.url));
const logoSource = path.join(outputDirectory, 'logo-sources', 'logo-black.png');
const iconDirectory = path.join(outputDirectory, 'icons');

function logoHref(directory) {
  return directory === outputDirectory ? 'logo-sources/logo-black.png' : '../logo-sources/logo-black.png';
}

function createLogoSvg(size, directory = outputDirectory) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image href="${logoHref(directory)}" width="${size}" height="${size}" preserveAspectRatio="none"/></svg>`;
}

function createIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image href="../logo-sources/logo-black.png" width="${size}" height="${size}" preserveAspectRatio="none"/></svg>`;
}

async function writePng(destination, size) {
  const mark = sharp(logoSource)
    .resize({ width: size, height: size, fit: 'fill' })
    .png();
  await mark.toFile(destination);
}

async function generate() {
  fs.mkdirSync(iconDirectory, { recursive: true });

  fs.writeFileSync(path.join(outputDirectory, 'logo.svg'), createLogoSvg(512));
  fs.writeFileSync(path.join(outputDirectory, 'favicon.svg'), createLogoSvg(64));

  await Promise.all([
    ...logoSizes.map((size) => writePng(path.join(outputDirectory, `logo-${size}.png`), size)),
    writePng(path.join(outputDirectory, 'favicon.png'), 32),
    ...iconSizes.map(async (size) => {
      fs.writeFileSync(path.join(iconDirectory, `icon-${size}x${size}.svg`), createIconSvg(size));
      await writePng(path.join(iconDirectory, `icon-${size}x${size}.png`), size);
    })
  ]);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
