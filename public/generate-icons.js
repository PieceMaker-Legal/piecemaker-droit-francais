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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image href="${logoHref(directory)}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/></svg>`;
}

function createIconSvg(size) {
  const radius = Math.round(size * 0.235);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#ffffff"/><image href="../logo-sources/logo-black.png" x="${size * 0.07}" y="${size * 0.07}" width="${size * 0.86}" height="${size * 0.86}" preserveAspectRatio="xMidYMid meet"/></svg>`;
}

async function writePng(destination, size, rounded) {
  const mark = sharp(logoSource)
    .resize({ width: Math.round(size * (rounded ? 0.86 : 0.98)), height: Math.round(size * (rounded ? 0.86 : 0.98)), fit: 'contain' })
    .png();
  const markBuffer = await mark.toBuffer();
  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: rounded ? '#ffffff' : { r: 255, g: 255, b: 255, alpha: 0 }
    }
  });
  await canvas
    .composite([{ input: markBuffer, gravity: 'centre' }])
    .png()
    .toFile(destination);
}

async function generate() {
  fs.mkdirSync(iconDirectory, { recursive: true });

  fs.writeFileSync(path.join(outputDirectory, 'logo.svg'), createLogoSvg(512));
  fs.writeFileSync(path.join(outputDirectory, 'favicon.svg'), createLogoSvg(64));

  await Promise.all([
    ...logoSizes.map((size) => writePng(path.join(outputDirectory, `logo-${size}.png`), size, true)),
    writePng(path.join(outputDirectory, 'favicon.png'), 32, true),
    ...iconSizes.map(async (size) => {
      fs.writeFileSync(path.join(iconDirectory, `icon-${size}x${size}.svg`), createIconSvg(size));
      await writePng(path.join(iconDirectory, `icon-${size}x${size}.png`), size, true);
    })
  ]);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
