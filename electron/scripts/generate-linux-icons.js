import fs from 'node:fs/promises';
import sharp from 'sharp';

const iconsDir = 'electron/assets/icons';
const sizes = [16, 32, 48, 64, 128, 256, 512];
const logoPath = 'public/logo-sources/logo-black.png';

async function renderPng(size) {
  const logo = (await fs.readFile(logoPath)).toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#ffffff"/><image href="data:image/png;base64,${logo}" width="${size}" height="${size}" preserveAspectRatio="none"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

await fs.mkdir(iconsDir, { recursive: true });

for (const size of sizes) {
  await fs.writeFile(`${iconsDir}/${size}x${size}.png`, await renderPng(size));
}

console.log(`Wrote ${sizes.length} icons to ${iconsDir}`);
