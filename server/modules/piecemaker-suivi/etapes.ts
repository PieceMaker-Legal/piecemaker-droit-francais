import { constants } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import express from 'express';

import { brainSuiviCopy, readEtapesOf, writeEtapesOf } from './case-store.js';
import { SUIVI_NAME, suiviPath } from './suivi.js';
import { dossierMatterId } from './suivi-board.js';
import type { createSuiviService } from './suivi-service.js';
import type { createTachesService, Tache } from './taches.js';

export const ETAPES_FILE = path.join('.piecemaker', 'etapes.json');
export const TYPES_FILE = 'types-documents.json';
export const ETATS_FILE = 'etats-dossiers.json';
export const SCAN_STATE_FILE = path.join('.piecemaker', 'anonymization-state.json');
export const ETAPES = ['preparation', 'raisonnement', 'redaction', 'finalisation', 'attente', 'clos'] as const;

type Etape = typeof ETAPES[number];
type Json = Record<string, unknown>;
type Document = { type: string; nom: string; chemin: string; valide?: boolean };
type Action = { texte: string; fait: boolean; echeance?: string; suivi?: string };
type Suite = { etape: Etape; documents?: Document[]; action?: Action; precedent?: string; remplacePar?: string };
type Etapes = { etape?: Etape; nonJuridique?: boolean; mappingValide?: string; raisonnements?: Record<string, Suite> };
type TypeDocument = { nom: string; skill: string; modele?: string };
type Ligne = { nom: string; texte: string; ok: boolean };
type Etat = { lignes: Ligne[]; pret: boolean };

export type EtapesDependencies = {
  home: string;
  suivi: ReturnType<typeof createSuiviService>;
  taches: ReturnType<typeof createTachesService>;
  etat(projectPath: string): Promise<Etat>;
  sessionOf(projectPath: string): string | null;
  bibliotheque: { skills(): Array<{ id: string; name: string }>; activer(projectPath: string, id: string): void };
};

const ETAT_MAX_AGE_MS = 300_000;
const ETAT_DELAI_MS = 2_000;
const PIECES_AFFICHEES = 10;
const QUESTION_CONSIGNE = '\n\nTu travailles sans l’avocat devant l’écran. S’il doit décider ou valider quelque chose, arrête-toi et termine ta réponse par une ligne « Question : … ». Il te répondra dans l’onglet Tâches.';
const VERSION = /-v(\d+)$/;
const CATALA_DIR = path.join('.piecemaker', 'catala');
const PROGRAMME = /^[\p{Ll}\p{N}][\p{Ll}\p{N}-]*$/u;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const EN_COURS: Etat = { pret: false, lignes: [] };
const abrege = (ligne: Ligne) => {
  const [titre, ...pieces] = ligne.texte.split('\n');
  return pieces.length > PIECES_AFFICHEES ? { ...ligne, texte: [titre, ...pieces.slice(0, PIECES_AFFICHEES), `  … et ${pieces.length - PIECES_AFFICHEES} autre(s)`].join('\n') } : ligne;
};
const exists = (file: string) => stat(file).then(() => true, () => false);
const listPrograms = async (root: string) => {
  const entries = await readdir(path.join(root, CATALA_DIR), { withFileTypes: true }).catch(() => []);
  const names = entries.filter((entry) => entry.isDirectory() && PROGRAMME.test(entry.name)).map((entry) => entry.name);
  const kept = await Promise.all(names.map(async (nom) => await exists(path.join(root, CATALA_DIR, nom, 'clerk.toml')) ? nom : null));
  return kept.filter((nom): nom is string => nom !== null).sort();
};
const carteId = (root: string, nom = '') => `${root}::${nom}`;
const slug = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} requis.`);
  return value.trim();
};
const safeName = (name: string) => path.basename(name).replace(/[\\/:*?"<>|]/g, '_');
const inside = (root: string, chemin: string) => {
  const target = path.resolve(root, chemin);
  if (target !== path.resolve(root) && !target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new TypeError('Chemin hors du dossier.');
  return target;
};
const writeJson = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
};
const readJson = async <T>(file: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return fallback; }
};
const freeName = async (root: string, folder: string, name: string) => {
  const { name: stem, ext } = path.parse(safeName(name));
  for (let index = 1; ; index += 1) {
    const candidate = path.join(folder, index === 1 ? `${stem}${ext}` : `${stem} (${index})${ext}`);
    if (!(await exists(path.join(root, candidate)))) return candidate;
  }
};

export function createEtapesService(deps: EtapesDependencies) {
  const locks = new Map<string, Promise<unknown>>();
  const etats = new Map<string, { at: number; value: Etat }>();
  const perimes = new Set<string>();
  const delais = new Map<string, NodeJS.Timeout>();
  let calculs: Promise<void> | null = null;
  const typesFile = path.join(deps.home, TYPES_FILE);
  const etatsFile = path.join(deps.home, ETATS_FILE);
  let enregistres: Promise<Record<string, Etat>> | null = null;
  let ecriture: Promise<void> = Promise.resolve();
  const enregistre = () => (enregistres ??= readJson<Record<string, Etat>>(etatsFile, {}));
  const enregistrer = (root: string, value: Etat) => {
    ecriture = ecriture.then(async () => {
      const tous = await enregistre();
      tous[root] = value;
      await writeJson(etatsFile, tous);
    }).catch(() => undefined);
  };

  const lastScan = async (root: string) => {
    const state = await readJson<{ files?: Record<string, { scanned?: { updatedAt?: string } }> }>(path.join(root, SCAN_STATE_FILE), {});
    return Object.values(state.files ?? {}).map((entry) => entry.scanned?.updatedAt ?? '').sort().at(-1) ?? '';
  };
  const read = async (root: string) => {
    const etapes = await readEtapesOf<Etapes>(root, {});
    if (etapes.mappingValide && new Date(await lastScan(root)) > new Date(etapes.mappingValide)) delete etapes.mappingValide;
    return etapes;
  };
  const serialiser = <T>(root: string, run: () => T | Promise<T>) => {
    const next = (locks.get(root) ?? Promise.resolve()).then(run);
    locks.set(root, next.catch(() => undefined));
    return next;
  };
  const change = <T>(root: string, run: (etapes: Etapes) => T | Promise<T>) => serialiser(root, async () => {
    const etapes = await read(root);
    const result = await run(etapes);
    await writeEtapesOf(root, etapes, writeJson);
    return result;
  });
  const project = (projectPath: unknown) => {
    const root = text(projectPath, 'projectPath');
    const found = deps.suivi.projects().find((entry) => path.resolve(entry.project_path) === path.resolve(root));
    if (!found) throw new TypeError('Dossier non enregistré.');
    return { root: found.project_path, nom: found.custom_project_name || path.basename(found.project_path) };
  };
  const verifier = async (root: string) => {
    perimes.delete(root);
    if ((await read(root)).nonJuridique) { etats.delete(root); return EN_COURS; }
    const value = await deps.etat(root).then((etat) => ({ ...etat, lignes: etat.lignes.map(abrege) }), () => null);
    if (!value) {
      const precedent = etats.get(root)?.value ?? (await enregistre())[root] ?? EN_COURS;
      etats.set(root, { at: 0, value: precedent });
      return precedent;
    }
    etats.set(root, { at: Date.now(), value });
    enregistrer(root, value);
    return value;
  };
  const enCalcul = new Map<string, Promise<Etat>>();
  const actualiser = (root: string) => {
    const actif = enCalcul.get(root);
    if (actif) return actif;
    const calcul = verifier(root).finally(() => enCalcul.delete(root));
    enCalcul.set(root, calcul);
    return calcul;
  };
  const recalculer = () => {
    calculs ??= (async () => { for (let [root] = perimes; root; [root] = perimes) await actualiser(root); })().finally(() => { calculs = null; });
  };
  const perimer = (root: string) => { perimes.add(root); recalculer(); };
  const invalider = (projectPath: string) => {
    const root = path.resolve(projectPath);
    if (delais.has(root)) return;
    const timer = setTimeout(() => { delais.delete(root); perimer(root); }, ETAT_DELAI_MS);
    timer.unref();
    delais.set(root, timer);
  };
  const etat = async (root: string, fresh = false) => {
    const cached = etats.get(root);
    if (fresh && (!cached || perimes.has(root))) return actualiser(root);
    if (!cached) { perimer(root); return (await enregistre())[root] ?? EN_COURS; }
    if (Date.now() - cached.at > ETAT_MAX_AGE_MS) perimer(root);
    return cached.value;
  };
  const types = () => readJson<TypeDocument[]>(typesFile, []);
  const typesOf = async (projectPath: unknown) => {
    const known = await types();
    project(projectPath);
    const skills = deps.bibliotheque.skills().map((entry) => entry.name).filter((skill) => skill.startsWith('redaction-') && !known.some((entry) => entry.skill === skill));
    return [...known, ...skills.map((skill) => ({ nom: skill.slice('redaction-'.length).replace(/-/g, ' ').replace(/^./, (first) => first.toUpperCase()), skill }))];
  };

  const suiviOf = async (root: string, nom: string) => {
    const files = await deps.suivi.files(root);
    return files.includes(`${nom}-${SUIVI_NAME}`) ? `${nom}-${SUIVI_NAME}` : files.includes(SUIVI_NAME) ? SUIVI_NAME : null;
  };
  const matterOf = async (root: string, nom?: string) => {
    const files = await deps.suivi.files(root).catch(() => [] as string[]);
    const fichier = (nom && files.includes(`${nom}-${SUIVI_NAME}`) ? `${nom}-${SUIVI_NAME}` : null) ?? (files.includes(SUIVI_NAME) ? SUIVI_NAME : files.length === 1 ? files[0] : null);
    return fichier ? dossierMatterId(root, fichier) : null;
  };
  const nextAction = async (root: string, nom: string): Promise<Action | null> => {
    const fichier = await suiviOf(root, nom);
    if (!fichier) return null;
    const snapshot = await deps.suivi.read(root, fichier).catch(() => null);
    if (!snapshot) return null;
    const due = snapshot.echeances.filter((deadline) => !deadline.fait && deadline.date).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    if (due) return { texte: `${due.intitule} — ${due.date}`, fait: false, echeance: due.nom, suivi: fichier };
    let matter: Json = {};
    try { const parsed: unknown = JSON.parse(snapshot.code); if (isObject(parsed) && isObject(parsed.matter)) matter = parsed.matter; } catch { matter = {}; }
    return typeof matter.nextStep === 'string' && matter.nextStep.trim() ? { texte: matter.nextStep.trim(), fait: false } : null;
  };
  const documentsOf = (root: string, documents: Document[] = []) => Promise.all(documents.map(async (document) => ({ ...document, statut: document.valide ? 'validé' : await exists(path.join(root, document.chemin)) ? 'en cours' : 'non commencé' })));
  const catalaOf = async (root: string, nom: string) => {
    const directory = path.join(root, CATALA_DIR, nom);
    const tache = await readJson(path.join(directory, 'tache.json'), null as unknown);
    const verification = await readJson(path.join(directory, 'resultats', 'verification.json'), null as unknown);
    const objectif = isObject(tache) && typeof tache.tache === 'string' && tache.tache.trim() ? tache.tache.trim() : null;
    const checks = isObject(verification) && Array.isArray(verification.checks) ? verification.checks.filter(isObject) : [];
    const echecs = checks.filter((check) => check.status !== 'passed');
    return { nom, titre: objectif ?? nom, qualification: null, acte: null, objectifs: objectif ? [objectif] : [], verifie: verification !== null, erreurs: echecs.length, manques: 0, alertes: echecs.map((check) => ({ kind: 'erreur', texte: typeof check.message === 'string' && check.message ? check.message : String(check.name) })) };
  };
  const history = (suites: Record<string, Suite>, nom: string) => {
    const chain: Array<{ nom: string; documents: Document[] }> = [];
    for (let current = suites[nom]?.precedent; current && suites[current]; current = suites[current].precedent) chain.unshift({ nom: current, documents: suites[current].documents ?? [] });
    return chain;
  };
  const tacheOf = (tache: Tache | null) => tache && { id: tache.id, statut: tache.statut, titre: tache.titre, sessionId: tache.sessionId };

  const tableau = async (fresh = false) => {
    const cartes: Json[] = [];
    for (const entry of deps.suivi.projects()) {
      const root = entry.project_path;
      const dossier = entry.custom_project_name || path.basename(root);
      const etapes = await read(root);
      const base = { projectPath: root, dossier, session: deps.sessionOf(root) };
      if (etapes.nonJuridique) { cartes.push({ ...base, id: carteId(root), etape: 'preparation', exclu: true }); continue; }
      const matter = await matterOf(root);
      const suites = etapes.raisonnements ?? {};
      const names = (await listPrograms(root)).filter((nom) => !suites[nom]?.remplacePar);
      const state = await etat(path.resolve(root), fresh);
      const preparation = { preparation: state.lignes, mappingValide: etapes.mappingValide ?? null };
      if (!names.length) {
        const etape = etapes.etape ?? (state.pret ? 'raisonnement' : 'preparation');
        cartes.push({ ...base, matter, id: carteId(root), etape, ...(etape === 'preparation' ? preparation : {}), aDemarrer: etape === 'raisonnement', tache: tacheOf(deps.taches.active(root, null)) });
      }
      for (const nom of names) {
        const suite = suites[nom] ?? { etape: 'raisonnement' };
        cartes.push({
          ...base,
          id: carteId(root, nom),
          matter: await matterOf(root, nom),
          etape: suite.etape,
          ...(suite.etape === 'preparation' ? preparation : {}),
          raisonnement: await catalaOf(root, nom),
          documents: await documentsOf(root, suite.documents),
          action: suite.action ?? (['finalisation', 'attente'].includes(suite.etape) ? await nextAction(root, nom) : null),
          historique: history(suites, nom).map((step) => ({ ...step, documents: step.documents })),
          tache: tacheOf(deps.taches.active(root, nom)),
        });
      }
    }
    return { cartes };
  };

  const suite = (etapes: Etapes, nom: string) => {
    etapes.raisonnements ??= {};
    etapes.raisonnements[nom] ??= { etape: 'raisonnement' };
    return etapes.raisonnements[nom];
  };
  const assertReasoning = async (root: string, nom: unknown) => {
    const name = text(nom, 'raisonnement');
    if (!(await listPrograms(root)).includes(name)) throw new TypeError('Programme Catala introuvable.');
    return name;
  };

  const dossier = async (body: Json) => {
    const { root } = project(body.projectPath);
    await change(root, (etapes) => {
      if (body.etape !== undefined) {
        if (!ETAPES.includes(body.etape as Etape)) throw new TypeError(`etape : ${ETAPES.join(', ')}.`);
        etapes.etape = body.etape as Etape;
      }
      if (typeof body.nonJuridique === 'boolean') etapes.nonJuridique = body.nonJuridique || undefined;
      if (body.mappingValide === true) etapes.mappingValide = new Date().toISOString();
      if (body.mappingValide === false) delete etapes.mappingValide;
    });
    perimer(path.resolve(root));
    return read(root);
  };

  const raisonnement = async (body: Json) => {
    const { root } = project(body.projectPath);
    const nom = await assertReasoning(root, body.raisonnement);
    const current = await nextAction(root, nom);
    return change(root, async (etapes) => {
      const entry = suite(etapes, nom);
      if (body.etape !== undefined) {
        if (!ETAPES.includes(body.etape as Etape)) throw new TypeError(`etape : ${ETAPES.join(', ')}.`);
        entry.etape = body.etape as Etape;
      }
      if (body.documents !== undefined) {
        if (!Array.isArray(body.documents)) throw new TypeError('documents : liste.');
        const precedents = entry.documents ?? [];
        const reserves = new Set(Object.values(etapes.raisonnements ?? {}).flatMap((item) => item.documents ?? []).map((document) => path.resolve(root, document.chemin)));
        const documents: Document[] = [];
        for (const document of body.documents) {
          if (!isObject(document)) throw new TypeError('document : { type, nom }.');
          const type = text(document.type, 'type'), name = text(document.nom, 'nom');
          let chemin = typeof document.chemin === 'string' && document.chemin.trim() ? document.chemin.trim() : path.join('Projets', `${safeName(name)}.docx`);
          const target = inside(root, chemin);
          const conserve = precedents.some((previous) => path.resolve(root, previous.chemin) === target) && !documents.some((previous) => path.resolve(root, previous.chemin) === target);
          if (!conserve) {
            const { dir, name: stem, ext } = path.parse(chemin);
            for (let index = 2; reserves.has(path.resolve(root, chemin)) || await exists(path.resolve(root, chemin)); index += 1) chemin = path.join(dir, `${stem} (${index})${ext}`);
          }
          reserves.add(path.resolve(root, chemin));
          documents.push({ type, nom: name, chemin, ...(document.valide === true ? { valide: true } : {}) });
        }
        entry.documents = documents;
      }
      if (body.action !== undefined) {
        if (body.action === null) delete entry.action;
        else {
          if (!isObject(body.action)) throw new TypeError('action : { texte, fait }.');
          const previous = entry.action ?? current;
          const action: Action = { ...previous, texte: typeof body.action.texte === 'string' ? body.action.texte : previous?.texte ?? '', fait: typeof body.action.fait === 'boolean' ? body.action.fait : previous?.fait ?? false };
          if (typeof body.action.texte === 'string' && body.action.texte !== previous?.texte) { delete action.echeance; delete action.suivi; }
          if (action.echeance && action.suivi && action.fait !== (previous?.fait ?? false)) await deps.suivi.mark(root, action.echeance, action.fait ? {} : { annuler: true }, action.suivi);
          entry.action = action;
        }
      }
      return entry;
    });
  };

  const piece = async (projectPath: unknown, nom: unknown, data: Buffer) => {
    const { root } = project(projectPath);
    const chemin = await freeName(root, 'Pièces', text(nom, 'nom'));
    await mkdir(path.join(root, 'Pièces'), { recursive: true });
    await writeFile(path.join(root, chemin), data);
    return { chemin };
  };

  const modele = async (nom: unknown, data: Buffer) => {
    const folder = path.join(deps.home, 'modeles-documents');
    await mkdir(folder, { recursive: true });
    const chemin = path.join(folder, `${Date.now()}-${safeName(text(nom, 'nom'))}`);
    await writeFile(chemin, data);
    return { chemin };
  };

  const ajouterType = async (body: Json) => {
    const nom = text(body.nom, 'nom');
    const list = (await types()).filter((entry) => entry.nom !== nom);
    const skill = typeof body.skill === 'string' && body.skill.trim() ? body.skill.trim() : `redaction-${slug(nom)}`;
    list.push({ nom, skill, ...(typeof body.modele === 'string' && body.modele ? { modele: body.modele } : {}) });
    await writeJson(typesFile, list);
    return list;
  };

  const reprise = async (body: Json) => {
    const { root } = project(body.projectPath);
    const nom = await assertReasoning(root, body.raisonnement);
    return serialiser(root, async () => {
      const etapes = await read(root);
      let precedent = nom;
      while (etapes.raisonnements?.[precedent]?.remplacePar) precedent = etapes.raisonnements[precedent].remplacePar!;
      const stem = precedent.replace(VERSION, '');
      const names = await listPrograms(root);
      let version = Number(VERSION.exec(precedent)?.[1] ?? 1) + 1;
      const known = await deps.suivi.files(root, true).catch(() => [] as string[]);
      while (names.includes(`${stem}-v${version}`) || known.includes(`${stem}-v${version}-${SUIVI_NAME}`) || await exists(path.join(root, suiviPath(`${stem}-v${version}-${SUIVI_NAME}`)))) version += 1;
      const next = `${stem}-v${version}`;
      const copies: string[] = [];
      try {
        const source = path.join(root, CATALA_DIR, precedent);
        const destination = path.join(root, CATALA_DIR, next);
        await cp(source, destination, { recursive: true, errorOnExist: true, force: false, filter: (file) => path.relative(source, file) !== 'resultats' });
        copies.push(destination);
        const fichier = await suiviOf(root, precedent);
        if (fichier && fichier !== SUIVI_NAME && !brainSuiviCopy(root, fichier, `${next}-${SUIVI_NAME}`)) {
          const destinationSuivi = path.join(root, suiviPath(`${next}-${SUIVI_NAME}`));
          await copyFile(path.join(root, suiviPath(fichier)), destinationSuivi, constants.COPYFILE_EXCL);
          copies.push(destinationSuivi);
        }
        suite(etapes, precedent).remplacePar = next;
        etapes.raisonnements![next] = { etape: 'raisonnement', precedent };
        await writeEtapesOf(root, etapes, writeJson);
        return { raisonnement: next };
      } catch (error) {
        await Promise.all(copies.map((file) => rm(file, { recursive: true, force: true })));
        throw error;
      }
    });
  };

  const skillLine = (root: string, type: TypeDocument | undefined, nomType: string) => {
    const skill = type?.skill ?? `redaction-${slug(nomType)}`;
    const modele = type?.modele ? ` Modèle ou document exemple : ${type.modele}.` : '';
    const found = deps.bibliotheque.skills().find((entry) => entry.name === skill);
    if (found) {
      deps.bibliotheque.activer(root, found.id);
      return `Utilise le skill \`${skill}\`.${modele}`;
    }
    return `Aucun skill n’existe pour ce type de document.${modele} À la fin de la conversation, demande à un sous-agent de créer le skill \`${skill}\` dans .claude/skills/${skill}/SKILL.md (frontmatter name: ${skill}), à partir du document produit${type?.modele ? ' et du modèle' : ''}. PieceMaker l’ajoute ensuite à la Bibliothèque, commune à toutes les IA.`;
  };

  const consignes = (instructions: string) => instructions ? `\n\nConsignes de l’avocat : ${instructions}` : '';

  const prompt = async (root: string, body: Json) => {
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
    const provider = text(body.provider, 'provider'), model = text(body.model, 'model');
    switch (body.type) {
      case 'conversion':
        return { titre: 'Conversion et anonymisation', prompt: `Lance pm dossier conversion, puis pm check. Indique à l’avocat de relire et valider le mapping dans l’onglet Dossier (bouton Mapping) : ne le valide pas à sa place.${consignes(instructions)}` };
      case 'index':
        return { titre: 'Index du dossier', prompt: `Supervise l’index du dossier.\n1. Lis l’arborescence commune avec pm dossier arborescence. Si elle reste ambiguë pour ce dossier, propose une arborescence à partir des dossiers existants. Propose-la en modifiant la clé « arborescence » de ~/.piecemaker/ontologie.json avec l’outil Edit ou Write : le hook en fait une proposition, l’avocat la valide dans Index › Classement.\n2. Demande à l’avocat s’il veut ajouter des questions en colonnes de l’index. Ajoute celles qu’il valide avec pm dossier index colonnes --questions.\n3. Lance pm dossier index lancer --ia ${provider} --modele-ia ${model}.\n4. Termine par pm check et résume ce qui reste à faire.${consignes(instructions)}` };
      case 'raisonnement':
        return { titre: 'Nouveau raisonnement', prompt: `Démarre le raisonnement juridique du dossier. Objectif(s) : ${instructions || 'à demander à l’avocat'}.\nLance pm check. Écris le programme Catala dans .piecemaker/catala/<nom>/ (nom en minuscules et tirets, d’après le sujet), selon le skill catala. Lance pm catala verifier --programme <nom> jusqu’à zéro erreur.` };
      case 'lever': {
        const nom = await assertReasoning(root, body.raisonnement);
        return { titre: `Lever manques et erreurs — ${nom}`, prompt: `Lève les erreurs du programme Catala ${nom}.\n1. Lance pm catala verifier --programme ${nom}.\n2. Corrige chaque erreur dans .piecemaker/catala/${nom}/. Complète les prémisses à partir des pièces (pm dossier sql).\n3. Relance la vérification jusqu’à zéro erreur.\n4. Liste à la fin ce qui demande une décision de l’avocat.${consignes(instructions)}` };
      }
      case 'redaction': {
        const nom = await assertReasoning(root, body.raisonnement);
        const document = ((await read(root)).raisonnements?.[nom]?.documents ?? [])[Number(body.document)];
        if (!document) throw new TypeError('Document introuvable : ajoutez-le à la carte.');
        const type = (await typesOf(root)).find((entry) => entry.nom === document.type);
        return { titre: `Rédaction — ${document.nom}`, prompt: `Rédige « ${document.nom} » (${document.type}) à partir du programme Catala .piecemaker/catala/${nom}/. Enregistre-le sous ${document.chemin}.\n${skillLine(root, type, document.type)}\nÀ la fin, inscris la prochaine action (par exemple : envoyer le projet à l’autre partie) dans matter.nextStep du suivi .piecemaker/${nom}-suivi.json, avec ses échéances, puis lance pm suivi_dossiers verifier --suivi ${nom}-suivi.json.${consignes(instructions)}` };
      }
      case 'reprise': {
        const nom = await assertReasoning(root, body.raisonnement);
        const chemin = text(body.piece, 'piece');
        const suites = (await read(root)).raisonnements ?? {};
        const precedent = suites[nom]?.precedent;
        return { titre: `Reprise — ${nom}`, prompt: `Une nouvelle pièce est arrivée : ${chemin}. Le programme Catala ${nom} est la nouvelle version${precedent ? ` de ${precedent}` : ''} : ne modifie pas l’ancienne.\n1. Lance pm dossier conversion "${chemin}", puis pm check.\n2. Lis la nouvelle pièce. Mets à jour .piecemaker/catala/${nom}/ en fonction de ce qu’elle apporte ou contredit.\n3. Lance pm catala verifier --programme ${nom} jusqu’à zéro erreur.\n4. Résume à l’avocat ce que la pièce change.${consignes(instructions)}` };
      }
      default:
        throw new TypeError('type : conversion, index, raisonnement, lever, redaction ou reprise.');
    }
  };

  const tache = async (body: Json, userId: number | null) => {
    const { root, nom } = project(body.projectPath);
    const { titre, prompt: content } = await prompt(root, body);
    const raisonnementNom = typeof body.raisonnement === 'string' && body.type !== 'raisonnement' ? body.raisonnement : null;
    const created = deps.taches.add({ projectPath: root, dossier: nom, raisonnement: raisonnementNom, type: String(body.type), titre, provider: text(body.provider, 'provider'), model: text(body.model, 'model'), prompt: `${content}${QUESTION_CONSIGNE}`, auto: body.auto !== false, userId });
    perimer(path.resolve(root));
    return created;
  };

  const conversion = async (projectPath: unknown, frais: boolean) => {
    const root = path.resolve(project(projectPath).root);
    if ((await read(root)).nonJuridique) return null;
    const state = frais ? await actualiser(root) : etats.get(root)?.value ?? (await enregistre())[root];
    const ligne = state?.lignes.find((item) => item.nom === 'conversion');
    if (!ligne) return null;
    return {
      aConvertir: !ligne.ok,
      bilan: ligne.texte.split('\n')[0].split(' : pm dossier conversion')[0],
      revoirMapping: !ligne.texte.startsWith('0 pièce(s)') && state?.lignes.find((item) => item.nom === 'mapping')?.ok === false,
    };
  };

  const lire = (projectPath: unknown) => read(project(projectPath).root);

  return { tableau, conversion, invalider, lire, dossier, raisonnement, piece, modele, ajouterType, reprise, tache, types: typesOf };
}

export function createEtapesRouter(service: ReturnType<typeof createEtapesService>, taches: ReturnType<typeof createTachesService>) {
  const router = express.Router();
  const handle = (run: (body: Json, request: express.Request) => unknown) => async (request: express.Request, response: express.Response) => {
    try {
      response.json(await run({ ...request.query, ...(isObject(request.body) ? request.body : {}) } as Json, request));
    } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Étapes indisponibles.' }); }
  };
  const userId = (request: express.Request) => {
    const id = (request as express.Request & { user?: { id?: unknown } }).user?.id;
    return typeof id === 'number' ? id : null;
  };
  const upload = express.raw({ type: () => true, limit: '200mb' });
  router.get('/', handle((body) => service.tableau(body.frais === '1')));
  router.get('/conversion', handle((body) => service.conversion(body.projectPath, body.frais === '1')));
  router.get('/dossier', handle((body) => service.lire(body.projectPath)));
  router.post('/dossier', express.json(), handle((body) => service.dossier(body)));
  router.post('/raisonnement', express.json(), handle((body) => service.raisonnement(body)));
  router.post('/reprise', express.json(), handle((body) => service.reprise(body)));
  router.post('/piece', upload, handle((body, request) => service.piece(body.projectPath, body.nom, request.body as Buffer)));
  router.post('/modele', upload, handle((body, request) => service.modele(body.nom, request.body as Buffer)));
  router.get('/types', handle((body) => service.types(body.projectPath)));
  router.post('/types', express.json(), handle((body) => service.ajouterType(body)));
  router.get('/taches', handle(() => taches.list()));
  router.post('/taches', express.json(), handle((body, request) => service.tache(body, userId(request))));
  router.post('/taches/:id/lancer', handle((_body, request) => taches.launch(String(request.params.id))));
  router.post('/taches/:id/auto', express.json(), handle((body, request) => taches.setAuto(String(request.params.id), body.auto === true)));
  router.post('/taches/:id/repondre', express.json(), handle((body, request) => taches.reply(String(request.params.id), text(body.texte, 'texte'))));
  router.post('/taches/:id/decision', express.json(), handle((body, request) => taches.decide(String(request.params.id), text(body.requestId, 'requestId'), { allow: body.allow === true, ...(body.updatedInput !== undefined ? { updatedInput: body.updatedInput } : {}), ...(typeof body.message === 'string' ? { message: body.message } : {}) })));
  router.post('/taches/:id/terminer', handle((_body, request) => taches.finish(String(request.params.id))));
  router.delete('/taches/:id', handle((_body, request) => { taches.remove(String(request.params.id)); return { ok: true }; }));
  return router;
}
