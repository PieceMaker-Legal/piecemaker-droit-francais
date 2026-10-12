import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-assistant-'));
const project = path.join(home, 'Dossier Exemple');
vi.stubEnv('HOME', home);

const { assistant } = await import('../server/assistant.js');

const launchers = () => ({
  isRunning: () => false,
  launchAnalysis: vi.fn(async (body: Record<string, unknown>) => ({ project, file: `${String(body.title)}.json`, status: 'running' as const, review: {} as never })),
  launchResearch: vi.fn(async () => ({ project, file: 'r.json', status: 'running' as const, review: {} as never })),
});

beforeAll(() => {
  fs.mkdirSync(path.join(project, 'Pièces', 'Contrats'), { recursive: true });
  fs.writeFileSync(path.join(project, 'Pièces', 'Contrats', 'bail.md'), '# Bail');
  fs.writeFileSync(path.join(project, 'Pièces', 'Contrats', 'avenant.md'), '# Avenant');
  fs.writeFileSync(path.join(project, 'Pièces', 'courrier.md'), '# Courrier');
  fs.mkdirSync(path.join(home, '.piecemaker'), { recursive: true });
  fs.writeFileSync(path.join(home, '.piecemaker', 'projects.json'), JSON.stringify({ sources: { test: [project] } }));
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('outil tabular_review', () => {
  it('prépare une analyse depuis un dossier de documents puis la lance', async () => {
    const run = launchers();
    const prepared = await assistant({ action: 'preparer', project, nom: 'Baux', documents: ['Pièces/Contrats/'], questions: [{ consigne: 'Quelle est la durée du bail ?' }] }, run) as Record<string, unknown>;
    expect(prepared).toMatchObject({ nom: 'Baux', mode: 'analyse', documents: ['Pièces/Contrats/avenant.md', 'Pièces/Contrats/bail.md'], questions: ['Quelle est la durée du bail ?'], ia: 'claude', modele_ia: 'haiku', a_completer: [] });
    const listed = await assistant({ action: 'lister', project }, run) as { projets: { projet: string }[] };
    expect(listed.projets.map((entry) => entry.projet)).toEqual([prepared.projet]);
    const launched = await assistant({ action: 'lancer', project, projet: prepared.projet, proxyOrigin: 'http://127.0.0.1:9' }, run);
    expect(launched).toEqual({ fichier: 'Baux.json', statut: 'running' });
    expect(run.launchAnalysis).toHaveBeenCalledWith(expect.objectContaining({ project, model: 'haiku', proxyOrigin: 'http://127.0.0.1:9', rows: [{ label: 'avenant', documents: ['Pièces/Contrats/avenant.md'] }, { label: 'bail', documents: ['Pièces/Contrats/bail.md'] }] }));
    expect((await assistant({ action: 'lister', project }, run) as { projets: unknown[] }).projets).toEqual([]);
  });

  it('prépare une recherche incomplète, la complète et signale ce qui manque', async () => {
    const run = launchers();
    const draft = await assistant({ action: 'preparer', project, mode: 'recherche', nom: 'Faute grave', recherche: { query: '"faute grave"' } }, run) as Record<string, unknown>;
    expect(draft.a_completer).toEqual(['questions', 'recherche : Choisissez au moins une juridiction.']);
    await expect(assistant({ action: 'lancer', project, projet: draft.projet }, run)).rejects.toThrow('À compléter avant de lancer');
    const completed = await assistant({ action: 'preparer', project, projet: draft.projet, recherche: { sources: ['cassation'], matieres: ['SOCIAL'] }, questions: [{ nom: 'Solution', consigne: 'Quelle est la solution ?' }] }, run) as Record<string, unknown>;
    expect(completed).toMatchObject({ mode: 'recherche', recherche: { query: '"faute grave"', sources: ['cassation'], matieres: ['SOCIAL'] }, questions: ['Solution'], a_completer: [] });
  });

  it('crée, lit et modifie un modèle', async () => {
    const run = launchers();
    const created = await assistant({ action: 'enregistrer_modele', nom: 'Modèle exemple', questions: [{ nom: 'Date', consigne: 'Quelle date ?', format: 'date' }] }, run) as Record<string, unknown>;
    expect(created).toMatchObject({ nom: 'Modèle exemple', questions: [{ nom: 'Date', consigne: 'Quelle date ?', format: 'date' }] });
    await assistant({ action: 'enregistrer_modele', modele: created.id, description: 'Pour les baux' }, run);
    expect(await assistant({ action: 'modeles', modele: 'modèle exemple' }, run)).toMatchObject({ id: created.id, description: 'Pour les baux', questions: [{ nom: 'Date' }] });
    expect((await assistant({ action: 'modeles' }, run) as { nom: string }[]).some((entry) => entry.nom === 'Modèle exemple')).toBe(true);
  });

  it('refuse un document inconnu et le tri des pièces', async () => {
    const run = launchers();
    await expect(assistant({ action: 'preparer', project, nom: 'X', documents: ['Absent/'] }, run)).rejects.toThrow('Aucun document Markdown pour « Absent/ »');
    await expect(assistant({ action: 'preparer', project, nom: 'X', modele: 'Tri des pièces' }, run)).rejects.toThrow('Tri des pièces');
    expect(await assistant({ action: 'documents', project }, run)).toEqual(['Pièces/Contrats/avenant.md', 'Pièces/Contrats/bail.md', 'Pièces/courrier.md']);
  });
});
