import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const logoSizes = [32, 64, 128, 256, 512];
const iconSizes = [72, 96, 128, 144, 152, 192, 384, 512];
const outputDirectory = path.dirname(fileURLToPath(import.meta.url));
const logoSource = path.join(outputDirectory, 'logo-sources', 'logo-black.png');
const iconDirectory = path.join(outputDirectory, 'icons');

const iconLogoRatio = 0.55;
const iconBackground = '#ffffff';

function logoHref(directory) {
  return directory === outputDirectory ? 'logo-sources/logo-black.png' : '../logo-sources/logo-black.png';
}

function createLogoSvg(size, directory = outputDirectory) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image href="${logoHref(directory)}" width="${size}" height="${size}" preserveAspectRatio="none"/></svg>`;
}

function createIconSvg(size) {
  const logoSize = Math.round(size * iconLogoRatio);
  const offset = Math.round((size - logoSize) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${iconBackground}"/><image href="../logo-sources/logo-black.png" x="${offset}" y="${offset}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="none"/></svg>`;
}

async function writePng(destination, size) {
  const mark = sharp(logoSource)
    .resize({ width: size, height: size, fit: 'fill' })
    .png();
  await mark.toFile(destination);
}

async function writeIconPng(destination, size) {
  const logoSize = Math.round(size * iconLogoRatio);
  const offset = Math.round((size - logoSize) / 2);
  const logo = await sharp(logoSource).resize({ width: logoSize, height: logoSize, fit: 'fill' }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: iconBackground } })
    .composite([{ input: logo, left: offset, top: offset }])
    .png()
    .toFile(destination);
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
      await writeIconPng(path.join(iconDirectory, `icon-${size}x${size}.png`), size);
    })
  ]);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
