import fs from 'node:fs/promises';
import sharp from 'sharp';

const size = 1024;
const assetsDir = 'electron/assets';
const iconPath = 'electron/assets/logo-macos.png';
const icnsPath = 'electron/assets/logo-macos.icns';
const lightLogoPath = 'public/logo-sources/logo-black.png';
const darkLogoPath = 'public/logo-sources/logo-white.png';
const darkIconPath = 'electron/assets/logo-macos-dark.png';

async function renderPng(entrySize, logoPath, background) {
  const logo = (await fs.readFile(logoPath)).toString('base64');
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${entrySize}" height="${entrySize}" viewBox="0 0 ${entrySize} ${entrySize}"><rect width="${entrySize}" height="${entrySize}" fill="${background}"/><image href="data:image/png;base64,${logo}" width="${entrySize}" height="${entrySize}" preserveAspectRatio="none"/></svg>`;
}

await fs.mkdir(assetsDir, { recursive: true });
const lightIcon = await renderPng(size, lightLogoPath, '#ffffff');
const darkIcon = await renderPng(size, darkLogoPath, '#111111');
await fs.writeFile(iconPath, await sharp(Buffer.from(lightIcon)).png().toBuffer());
await fs.writeFile(darkIconPath, await sharp(Buffer.from(darkIcon)).png().toBuffer());

const icnsEntries = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];

const blocks = await Promise.all(icnsEntries.map(async ([type, entrySize]) => {
  const png = await sharp(Buffer.from(await renderPng(entrySize, lightLogoPath, '#ffffff'))).png().toBuffer();
  const block = Buffer.alloc(8 + png.length);
  block.write(type, 0, 4, 'ascii');
  block.writeUInt32BE(block.length, 4);
  png.copy(block, 8);
  return block;
}));

const totalLength = 8 + blocks.reduce((sum, block) => sum + block.length, 0);
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(totalLength, 4);

await fs.writeFile(icnsPath, Buffer.concat([header, ...blocks], totalLength));
