import { describe, expect, it } from 'vitest';

import { PANEL_FOCUS_EVENT, readWorkspaceContext, setActiveDocument, syncPanels } from '@/modules/piecemaker-context-suggestions/contextStore';
import { suggestQuestions } from '@/modules/piecemaker-context-suggestions/suggestion';

const PROJECT = '/dossiers/Dupont';
let reset = 0;
const question = () => suggestQuestions(readWorkspaceContext())[0] ?? null;
const focus = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent(PANEL_FOCUS_EVENT, { detail }));

function start() {
  syncPanels(`/vide-${reset += 1}`, []);
  setActiveDocument(null);
  syncPanels(PROJECT, []);
}

describe('question proposée selon le dernier volet ouvert', () => {
  it('ne propose rien sans volet et propose la réorganisation sur Fichiers', () => {
    start();
    expect(question()).toBeNull();
    syncPanels(PROJECT, ['files']);
    expect(question()).toBe('Propose-moi une réorganisation de mes documents en dossiers clairs.');
  });

  it('suit le dernier volet ouvert et fait disparaître la question quand il se ferme', () => {
    start();
    syncPanels(PROJECT, ['files']);
    syncPanels(PROJECT, ['files', 'plugin:piecemaker-tampon']);
    expect(question()).toBe('Tamponne mes pièces.');
    syncPanels(PROJECT, ['files']);
    expect(question()).toBeNull();
    syncPanels(PROJECT, ['files', 'plugin:piecemaker-library']);
    expect(suggestQuestions(readWorkspaceContext())).toEqual(['Écris une nouvelle skill pour ', 'Analyse les sessions passées et liste les skills qui pourraient être rédigés.']);
  });

  it('cible le document ouvert avec @', () => {
    start();
    syncPanels(PROJECT, ['files']);
    setActiveDocument(`${PROJECT}/Pièces/contrat de bail.md`);
    expect(question()).toBe('Résume @"Pièces/contrat de bail.md" et relève les points utiles au dossier.');
    setActiveDocument(`${PROJECT}/Actes/assignation.docx`);
    expect(question()).toBe('Relis @Actes/assignation.docx et propose-moi des corrections.');
    setActiveDocument(null);
    expect(question()).toBeNull();
  });

  it('cible la chronologie et le tableau affichés par les plugins', () => {
    start();
    syncPanels(PROJECT, ['plugin:piecemaker-dossier']);
    expect(question()).toBeNull();
    focus({ tab: 'plugin:piecemaker-dossier', view: 'chronology' });
    expect(question()).toBe('Vérifie la chronologie du dossier : dates manquantes, incohérences et trous.');
    syncPanels(PROJECT, ['plugin:piecemaker-dossier', 'plugin:piecemaker-tabular-review']);
    expect(question()).toBe('Prépare une analyse tabulaire des documents du dossier.');
    focus({ tab: 'plugin:piecemaker-tabular-review', file: `${PROJECT}/Tabular Review/baux.json` });
    expect(question()).toBe('Analyse le tableau @"Tabular Review/baux.json" : quelles lignes méritent mon attention ?');
  });

  it('ne vole pas le premier plan quand un plugin republie le même état', () => {
    start();
    syncPanels(PROJECT, ['plugin:piecemaker-dossier']);
    focus({ tab: 'plugin:piecemaker-dossier', view: 'chronology' });
    syncPanels(PROJECT, ['plugin:piecemaker-dossier', 'files']);
    focus({ tab: 'plugin:piecemaker-dossier', view: 'chronology' });
    expect(question()).toBe('Propose-moi une réorganisation de mes documents en dossiers clairs.');
  });
});
