import { pinArchive } from './catala-archive.mjs';
import { catalaRecipe } from './catala.mjs';

const { archive } = catalaRecipe;
if (!archive.tag) throw new Error('Construisez, vérifiez et épinglez les archives Catala Mac et Windows avant la release.');
const platforms = ['macos', 'windows'];
const assets = platforms.map((platform) => ({ name: archive[platform]?.asset, digest: `sha256:${archive[platform]?.sha256}`, size: archive[platform]?.size }));
const receipts = Object.fromEntries(platforms.map((platform) => [platform, archive[platform]?.verification]));
pinArchive(catalaRecipe, archive.tag, assets, receipts);
console.log('Archives Catala Mac et Windows épinglées avec leurs contrôles complets.');
