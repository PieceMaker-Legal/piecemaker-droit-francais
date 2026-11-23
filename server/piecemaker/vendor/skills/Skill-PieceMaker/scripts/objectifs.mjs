import fs from 'node:fs';
import path from 'node:path';

export const OBJECTIFS_FILE = '.piecemaker/objectifs.md';
export const OBJECTIF_PREFIX = 'Objectif : ';
export const STATUTS = ['en cours', 'en attente', 'atteint', 'abandonné'];
const PARTIES_DIR = path.join('.piecemaker', 'okf', '_parties');
const PREMISES_DIR = path.join('.piecemaker', 'okf', '_premises');
const MODELE = 'modèle : Feature read case path=piecemaker/references/objectifs.md';

const fold = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');
export const premiseSlug = (title) => {
  const given = /^okf:\/_premises\/(.+)\.md$/.exec(title.trim());
  return given ? given[1] : fold(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

export function parseObjectifs(text) {
  const objectifs = [];
  let current = null;
  let liste = null;
  String(text).split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1].startsWith(OBJECTIF_PREFIX) ? { nom: heading[1].slice(OBJECTIF_PREFIX.length).trim(), ligne: index + 1, champs: {}, parties: [], points: [], actes: [] } : null;
      if (current) objectifs.push(current);
      liste = null;
      return;
    }
    if (!current) return;
    const item = /^\s*[-*] (.+?)\s*$/.exec(line);
    if (item && liste) {
      current[liste].push({ texte: item[1], ligne: index + 1 });
      return;
    }
    const champ = /^([^:\-*][^:]*?)\s*:\s*(.*?)\s*$/.exec(line);
    if (!champ) { if (line.trim()) liste = null; return; }
    const cle = champ[1].trim();
    liste = cle === 'Parties' ? 'parties' : cle === 'Points à établir' ? 'points' : null;
    if (cle === 'Actes') current.actes = champ[2].split(',').map((nom) => nom.trim()).filter(Boolean);
    else if (!liste) current.champs[cle] = { valeur: champ[2], ligne: index + 1 };
  });
  return objectifs;
}

const exists = (folder, directory, name) => fs.existsSync(path.join(folder, directory, `${name}.md`));

export function verifierObjectifs(folder, { actes = [] } = {}) {
  let text;
  try { text = fs.readFileSync(path.join(folder, OBJECTIFS_FILE), 'utf8'); } catch {
    return { objectifs: [], erreurs: [`${OBJECTIFS_FILE} : introuvable. Définissez avec l’avocat le ou les objectifs du dossier et les parties de chacun, puis écrivez-les (${MODELE}).`], manques: [] };
  }
  const objectifs = parseObjectifs(text);
  const erreurs = [];
  const manques = [];
  const at = (ligne) => `${OBJECTIFS_FILE}:${ligne}`;
  if (/^---\r?\n/.test(text)) erreurs.push(`${at(1)}: erreur : pas de frontmatter ; chaque objectif est une section « ## ${OBJECTIF_PREFIX}<intitulé> ».`);
  if (!objectifs.length) erreurs.push(`${at(1)}: erreur : aucun objectif. Écrivez une section « ## ${OBJECTIF_PREFIX}<intitulé> » par objectif (${MODELE}).`);
  for (const objectif of objectifs) {
    const nom = `« ${objectif.nom} »`;
    if (!objectif.nom) erreurs.push(`${at(objectif.ligne)}: erreur : objectif sans intitulé.`);
    if (!objectif.champs['Résultat recherché']?.valeur) erreurs.push(`${at(objectif.ligne)}: erreur : objectif ${nom} sans « Résultat recherché : » (ce que le client veut obtenir).`);
    const statut = objectif.champs.Statut;
    if (statut && !STATUTS.includes(statut.valeur)) erreurs.push(`${at(statut.ligne)}: erreur : statut « ${statut.valeur} » inconnu. Statuts admis : ${STATUTS.join(', ')}.`);
    if (!objectif.parties.length) erreurs.push(`${at(objectif.ligne)}: erreur : objectif ${nom} sans partie. Sous « Parties : », une ligne « - <CODE> : <rôle dans cet objectif> » par partie.`);
    for (const partie of objectif.parties) {
      const [code, role] = partie.texte.split(/\s*:\s*/, 2);
      if (!role) erreurs.push(`${at(partie.ligne)}: erreur : écrivez « - ${code} : <rôle dans cet objectif> ».`);
      if (!/^[A-Z0-9_]+$/.test(code)) erreurs.push(`${at(partie.ligne)}: erreur : « ${code} » n’est pas un code de partie de l’index (ex. PERSONNE_PHYSIQUE_01) ; un nom ne va pas ici.`);
      else if (!exists(folder, PARTIES_DIR, code)) manques.push(`${at(partie.ligne)}: manque : ${code} n’est pas une partie de l’index ; la qualification attend l’avocat (onglet Dossier, vue générale).`);
    }
    for (const point of objectif.points) {
      const slug = premiseSlug(point.texte);
      if (slug && !exists(folder, PREMISES_DIR, slug)) manques.push(`${at(point.ligne)}: manque : point à établir sans prémisse dans l’index (okf:/_premises/${slug}.md) : cherchez-le dans les pièces (skill okf).`);
    }
  }
  const servis = new Set(objectifs.flatMap((objectif) => objectif.actes));
  for (const acte of actes) if (!servis.has(acte)) manques.push(`${OBJECTIFS_FILE} : manque : l’acte ${acte} ne sert aucun objectif ; ajoutez-le à la ligne « Actes : » de l’objectif qu’il sert.`);
  return { objectifs, erreurs, manques };
}

export function rapportObjectifs(result) {
  return [...result.erreurs, ...result.manques, `Objectifs : ${result.objectifs.length} objectif(s), ${result.erreurs.length} erreur(s), ${result.manques.length} manque(s).`].join('\n');
}
