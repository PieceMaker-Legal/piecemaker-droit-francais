import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeEditor } from '../editors.js';
import type { KnowledgeNode, KnowledgeSnapshot } from '../types.js';

let dom: JSDOM;
let root: HTMLElement;
const code = 'CLIENT_DEMANDEUR_PERSONNE_MORALE_01';
const company: KnowledgeNode = { projectId: 'dossier-exemple', id: `entity:${code}`, kind: 'company', label: 'Société Exemple SAS', aliases: ['ZETABIO'], data: { code, partySide: 'client' }, date: null, createdAt: '', updatedAt: '' };
const graph = (): KnowledgeSnapshot => ({ projectId: company.projectId, nodes: [company], mappings: [{ projectId: company.projectId, nodeId: company.id, real: company.label, masked: code, data: {} }], links: [], citations: [] });
const address: KnowledgeNode = { ...company, id: 'entity:ADRESSE_01', kind: 'address', label: '12 rue des Lilas, Paris', aliases: [], data: { code: 'ADRESSE_01' } };
const graphWithAddress = (): KnowledgeSnapshot => ({ ...graph(), nodes: [company, address], links: [{ projectId: company.projectId, fromNodeId: company.id, toNodeId: address.id, relation: 'adresse', data: {} }] });
const input = (name: string) => root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
const select = (name: string, value: string) => { input(name).value = value; input(name).dispatchEvent(new dom.window.Event('change')); };
const fill = (name: string, value: string) => { input(name).value = value; input(name).dispatchEvent(new dom.window.Event('input')); };
const submit = () => root.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('FormData', dom.window.FormData);
  root = dom.window.document.getElementById('root')!;
});

afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });

describe('entity editor', () => {
  it('shows the linked address in main information and groups identity fields in anonymisation', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graphWithAddress() }, company, save);
    expect(input('address').value).toBe(address.label);
    expect(input('address').closest('section')!.querySelector('h3')!.textContent).toBe('Informations principales');
    for (const name of ['label', 'aliases', 'masked']) expect(input(name).closest('section')!.querySelector('h3')!.textContent).toBe('Anonymisation');
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].some((operation: { op: string }) => operation.op === 'link' || operation.op === 'unlink')).toBe(false);
  });

  it('creates an anonymised address without reusing a reserved code', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const snapshot = graph();
    snapshot.reservedCodes = ['ADRESSE_01'];
    nodeEditor(root, { graph: snapshot }, company, save);
    fill('address', address.label);
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toEqual(expect.arrayContaining([
      { op: 'upsertNode', node: { id: 'entity:ADRESSE_02', kind: 'address', label: address.label, aliases: [], data: { code: 'ADRESSE_02' } } },
      { op: 'upsertMapping', mapping: { nodeId: 'entity:ADRESSE_02', real: address.label, masked: 'ADRESSE_02' } },
      { op: 'link', link: { fromNodeId: company.id, toNodeId: 'entity:ADRESSE_02', relation: 'adresse' } },
    ]));
  });

  it('reuses an existing address and relinks it when the entity code changes', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const snapshot = graphWithAddress();
    const otherAddress = { ...address, id: 'entity:ADRESSE_02', label: '24 rue des Roses, Lyon', data: { code: 'ADRESSE_02' } };
    snapshot.nodes.push(otherAddress);
    nodeEditor(root, { graph: snapshot }, company, save);
    fill('address', otherAddress.label);
    fill('masked', 'ENTITE_EXEMPLE_07');
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toEqual(expect.arrayContaining([
      { op: 'unlink', link: { fromNodeId: 'entity:ENTITE_EXEMPLE_07', toNodeId: address.id, relation: 'adresse' } },
      { op: 'link', link: { fromNodeId: 'entity:ENTITE_EXEMPLE_07', toNodeId: otherAddress.id, relation: 'adresse' } },
    ]));
    expect(save.mock.calls[0][0].filter((operation: { op: string }) => operation.op === 'upsertNode')).toHaveLength(1);
  });

  it('clears the address link without deleting a shared address', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graphWithAddress() }, company, save);
    fill('address', '');
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toContainEqual({ op: 'unlink', link: { fromNodeId: company.id, toNodeId: address.id, relation: 'adresse' } });
    expect(save.mock.calls[0][0].some((operation: { op: string }) => operation.op === 'deleteNode')).toBe(false);
  });

  it('switches the default avatar between companies and people', () => {
    nodeEditor(root, { graph: graph() }, company, vi.fn().mockResolvedValue(undefined));
    const avatar = root.querySelector('[data-profile-avatar]')!;
    const companyIcon = avatar.innerHTML;
    select('kind', 'person');
    expect(avatar.innerHTML).not.toBe(companyIcon);
    select('kind', 'company');
    expect(avatar.innerHTML).toBe(companyIcon);
  });

  it('saves a custom code and keeps it when role, position and legal form change', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graph() }, company, save);
    expect(input('masked').readOnly).toBe(false);
    fill('masked', 'ENTITE_EXEMPLE_07');
    select('partySide', 'adversaire');
    select('position', 'appelant');
    fill('legalForm', 'SAS');
    expect(input('masked').value).toBe('ENTITE_EXEMPLE_07');
    expect(root.querySelector('[data-profile-role]')!.textContent).toBe('Partie adverse');
    expect(root.querySelector<HTMLElement>('.pmd-profile-editor')!.dataset.side).toBe('adversaire');
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toEqual(expect.arrayContaining([
      { op: 'renameNode', rename: { fromNodeId: company.id, toNodeId: 'entity:ENTITE_EXEMPLE_07' } },
      expect.objectContaining({ op: 'upsertNode', node: expect.objectContaining({ id: 'entity:ENTITE_EXEMPLE_07', data: expect.objectContaining({ code: 'ENTITE_EXEMPLE_07', legalForm: 'SAS', partySide: 'adversaire', position: 'appelant' }) }) }),
      { op: 'upsertMapping', mapping: { nodeId: 'entity:ENTITE_EXEMPLE_07', real: company.label, masked: 'ENTITE_EXEMPLE_07' } },
    ]));
  });

  it('preserves the current code when only the name changes', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graph() }, company, save);
    fill('label', 'ZETABIO');
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toEqual(expect.arrayContaining([{ op: 'upsertMapping', mapping: { nodeId: company.id, real: 'ZETABIO', masked: code } }]));
    expect(save.mock.calls[0][0].some((operation: { op: string }) => operation.op === 'renameNode')).toBe(false);
  });

  it('rejects a custom code already held by another entity', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const snapshot = graph();
    snapshot.reservedCodes = ['ENTITE_EXEMPLE_07'];
    nodeEditor(root, { graph: snapshot }, company, save);
    fill('masked', 'ENTITE_EXEMPLE_07');
    submit();
    expect(save).not.toHaveBeenCalled();
    expect(input('masked').validationMessage).toContain('déjà utilisé');
  });

  it('shows saved links before the fields for adding a link', () => {
    const snapshot = graph();
    snapshot.nodes.push({ ...company, id: 'entity:PERSONNE_PHYSIQUE_01', kind: 'person', label: 'Jean Dupont', aliases: [], data: {} });
    snapshot.links.push({ projectId: company.projectId, fromNodeId: company.id, toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'dirigeant', data: {} });
    nodeEditor(root, { graph: snapshot }, company, vi.fn().mockResolvedValue(undefined));
    const savedLink = root.querySelector('[data-unlink]')!;
    expect(savedLink.compareDocumentPosition(input('target')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
