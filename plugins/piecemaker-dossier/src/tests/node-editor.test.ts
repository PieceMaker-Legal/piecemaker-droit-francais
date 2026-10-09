import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeEditor } from '../editors.js';
import { knowledgeApi } from '../api.js';
import type { CompanySearchResult } from '../api.js';
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
const registryCompany: CompanySearchResult = { name: 'Société Exemple SAS', siren: '123456789', summary: 'SAS · En activité', url: 'https://registre-public.com/?e=123456789', details: 'Fiche de société fictive', fields: { legalName: 'Société Exemple SAS', legalForm: 'SAS', status: 'En activité', siren: '123456789', siret: '12345678900010', vat: '', legalFormCode: '5710', naf: '62.01Z', creationDate: '2020-01-01', category: 'PME', address: '24 rue des Roses, Lyon', capital: '10 000 EUR', directors: [], finances: [], source: 'https://registre-public.com/?e=123456789' } };

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('FormData', dom.window.FormData);
  root = dom.window.document.getElementById('root')!;
});

afterEach(() => { dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('entity editor', () => {
  it.each(['person', 'company'] as const)('excludes an existing %s and all its variants only in this case', async (kind) => {
    const save = vi.fn().mockResolvedValue(undefined);
    const terms = vi.spyOn(knowledgeApi, 'institutionalTerms');
    const node = { ...company, kind };
    const snapshot = graph();
    snapshot.mappings.push({ ...snapshot.mappings[0], real: 'Société Fictive' });
    nodeEditor(root, { graph: snapshot }, node, save);
    fill('label', 'Nom non enregistré');
    root.querySelector<HTMLButtonElement>('[data-delete-entity]')!.click();
    expect(save).not.toHaveBeenCalled();
    expect(root.querySelector('[data-node-form]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-delete-scope="dossier"]')!.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith([
      { op: 'excludeTerm', term: company.label },
      { op: 'excludeTerm', term: 'ZETABIO' },
      { op: 'excludeTerm', term: 'Société Fictive' },
      { op: 'deleteNode', nodeId: company.id },
    ]));
    await vi.waitFor(() => expect(root.querySelector('[data-node-form]')).toBeNull());
    expect(terms).not.toHaveBeenCalled();
  });

  it('adds the stored name to the global exclusions before deleting', async () => {
    vi.spyOn(knowledgeApi, 'institutionalTerms').mockResolvedValue({ file: '/exclusions-fictives.txt', terms: ['Mot exclu'] });
    const exclude = vi.spyOn(knowledgeApi, 'saveInstitutionalTerms').mockResolvedValue({ file: '/exclusions-fictives.txt', terms: ['Mot exclu', company.label] });
    const save = vi.fn().mockImplementation(async () => {
      expect(exclude).toHaveBeenCalledExactlyOnceWith(['Mot exclu', company.label]);
    });
    nodeEditor(root, { graph: graph() }, company, save);
    root.querySelector<HTMLButtonElement>('[data-delete-entity]')!.click();
    expect(root.querySelector('[data-delete-scope="tous"]')!.textContent).toContain('Ajouter à la liste des exclusions');
    root.querySelector<HTMLButtonElement>('[data-delete-scope="tous"]')!.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith([{ op: 'deleteNode', nodeId: company.id }]));
    await vi.waitFor(() => expect(root.querySelector('[data-node-form]')).toBeNull());
  });

  it.each(['button', 'escape', 'backdrop'])('cancels deletion with %s and keeps unsaved edits', async (method) => {
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graph() }, company, save);
    fill('label', 'Nom non enregistré');
    root.querySelector<HTMLButtonElement>('[data-delete-entity]')!.click();
    const overlay = root.querySelector<HTMLElement>('.pmd-modal:has([data-delete-scope])')!;
    if (method === 'button') overlay.querySelector<HTMLButtonElement>('[data-close]')!.click();
    else if (method === 'escape') dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    else overlay.click();
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('[data-delete-entity]')!.disabled).toBe(false));
    expect(save).not.toHaveBeenCalled();
    expect(input('label').value).toBe('Nom non enregistré');
    expect(root.querySelector('[data-delete-scope]')).toBeNull();
  });

  it('keeps the editor open and allows retrying a failed deletion', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Enregistrement impossible')).mockResolvedValue(undefined);
    nodeEditor(root, { graph: graph() }, company, save);
    const button = root.querySelector<HTMLButtonElement>('[data-delete-entity]')!;
    button.click();
    root.querySelector<HTMLButtonElement>('[data-delete-scope="dossier"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('[data-delete-error]')!.textContent).toBe('Enregistrement impossible'));
    expect(button.disabled).toBe(false);
    expect(root.querySelector('[data-node-form]')).not.toBeNull();
    button.click();
    root.querySelector<HTMLButtonElement>('[data-delete-scope="dossier"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('[data-node-form]')).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not delete when saving global exclusions fails', async () => {
    vi.spyOn(knowledgeApi, 'institutionalTerms').mockResolvedValue({ file: '/exclusions-fictives.txt', terms: [] });
    vi.spyOn(knowledgeApi, 'saveInstitutionalTerms').mockRejectedValue(new Error('Exclusion impossible'));
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graph() }, company, save);
    root.querySelector<HTMLButtonElement>('[data-delete-entity]')!.click();
    root.querySelector<HTMLButtonElement>('[data-delete-scope="tous"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('[data-delete-error]')!.textContent).toBe('Exclusion impossible'));
    expect(save).not.toHaveBeenCalled();
    expect(root.querySelector('[data-node-form]')).not.toBeNull();
  });

  it('does not offer deletion when creating a person', () => {
    nodeEditor(root, { graph: graph() }, null, vi.fn());
    expect(root.querySelector('[data-delete-entity]')).toBeNull();
  });

  it.each(['demandeur', 'defendeur', 'appelant', 'intime', 'requerant', 'mis_en_cause', 'intervenant', 'autre'])('leaves the position empty when it is absent from the database (%s)', (position) => {
    const masked = `ADVERSAIRE_${position.toUpperCase()}_PERSONNE_PHYSIQUE_01`;
    const person: KnowledgeNode = { ...company, id: `entity:${masked}`, kind: 'person', label: 'Jean Dupont', aliases: [], data: { code: masked, partySide: 'adversaire' } };
    nodeEditor(root, { graph: { ...graph(), nodes: [person], mappings: [{ ...graph().mappings[0], nodeId: person.id, real: person.label, masked }] } }, person, vi.fn().mockResolvedValue(undefined));
    expect(input('position').value).toBe('');
  });

  it.each(['appelant', 'Appelant'])('preserves an explicit position over the position encoded in the anonymised code (%s)', (position) => {
    const node = { ...company, data: { ...company.data, position } };
    nodeEditor(root, { graph: graph() }, node, vi.fn().mockResolvedValue(undefined));
    expect(input('position').value).toBe('appelant');
  });

  it('does not infer a position from a mapping', () => {
    const masked = 'CLIENT_DEFENDEUR_PERSONNE_PHYSIQUE_01';
    const person: KnowledgeNode = { ...company, id: 'manual:person', kind: 'person', label: 'Jean Dupont', aliases: [], data: { partySide: 'client' } };
    nodeEditor(root, { graph: { ...graph(), nodes: [person], mappings: [{ ...graph().mappings[0], nodeId: person.id, real: person.label, masked }] } }, person, vi.fn().mockResolvedValue(undefined));
    expect(input('position').value).toBe('');
  });

  it('saves the selected position before asking the server to derive its code', async () => {
    const masked = 'ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01';
    const person: KnowledgeNode = { ...company, id: `entity:${masked}`, kind: 'person', label: 'Jean Dupont', aliases: [], data: { code: masked, partySide: 'adversaire' } };
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: { ...graph(), nodes: [person], mappings: [{ ...graph().mappings[0], nodeId: person.id, real: person.label, masked }] } }, person, save);
    select('position', 'demandeur');
    expect(input('masked').value).toBe(masked);
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0][0]).toMatchObject({ op: 'upsertNode', node: { id: person.id, data: { position: 'demandeur', code: masked } } });
    expect(save.mock.calls[0][0].at(-1)).toEqual({ op: 'syncPartyCode', nodeId: person.id, customCode: undefined });
    expect(save.mock.calls[0][0].some((operation: { op: string }) => operation.op === 'renameNode')).toBe(false);
  });

  it('offers identity search only for companies', () => {
    nodeEditor(root, { graph: graph() }, company, vi.fn().mockResolvedValue(undefined));
    const button = root.querySelector<HTMLButtonElement>('[data-search-identity]')!;
    expect(button.hidden).toBe(false);
    expect(button.parentElement!.querySelector('h3')!.textContent).toBe('Informations principales');
    select('kind', 'person');
    expect(button.hidden).toBe(true);
    select('kind', 'company');
    expect(button.hidden).toBe(false);
  });

  it('searches companies in a separate popup and saves only the chosen identity', async () => {
    const search = vi.spyOn(knowledgeApi, 'searchCompanies').mockResolvedValue({ query: company.label, results: [registryCompany, { ...registryCompany, name: 'Autre Société Exemple', siren: '987654321' }] });
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graphWithAddress() }, company, save);
    fill('masked', 'ENTITE_EXEMPLE_07');
    root.querySelector<HTMLButtonElement>('[data-search-identity]')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('.pmd-company-result')).toHaveLength(2));
    expect(search).toHaveBeenCalledExactlyOnceWith(company.label);
    expect(save).not.toHaveBeenCalled();
    expect(root.querySelector('.pmd-company-search-dialog')!.textContent).toContain('10 000 EUR');
    root.querySelector<HTMLButtonElement>('[data-company-result="0"]')!.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'upsertNode', node: expect.objectContaining({ kind: 'company', id: company.id, data: expect.objectContaining({ capital: '10 000 EUR', legalForm: 'SAS' }) }) }),
      { op: 'unlink', link: { fromNodeId: company.id, toNodeId: address.id, relation: 'adresse' } },
      { op: 'syncPartyCode', nodeId: company.id, customCode: 'ENTITE_EXEMPLE_07' },
      expect.objectContaining({ op: 'link', link: expect.objectContaining({ relation: 'SIREN' }) }),
    ]));
    await vi.waitFor(() => expect(root.querySelector('.pmd-company-search-dialog')).toBeNull());
  });

  it('allows retrying a failed registry search and closing without saving', async () => {
    const search = vi.spyOn(knowledgeApi, 'searchCompanies').mockRejectedValueOnce(new Error('Registre indisponible')).mockResolvedValueOnce({ query: 'ZETABIO', results: [] });
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graph() }, company, save);
    root.querySelector<HTMLButtonElement>('[data-search-identity]')!.click();
    await vi.waitFor(() => expect(root.querySelector('[data-company-status]')!.textContent).toBe('Registre indisponible'));
    const popup = root.querySelector('.pmd-company-search-dialog')!;
    popup.querySelector<HTMLInputElement>('input[name="query"]')!.value = 'ZETABIO';
    popup.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(popup.querySelector('[data-company-status]')!.textContent).toContain('Aucune société'));
    popup.querySelector<HTMLButtonElement>('[data-close]')!.click();
    expect(root.querySelector('.pmd-company-search-dialog')).toBeNull();
    expect(root.querySelector('[data-node-form]')).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('saves a manually entered capital', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graph() }, company, save);
    fill('capital', '20 000 EUR');
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'upsertNode', node: expect.objectContaining({ data: expect.objectContaining({ capital: '20 000 EUR' }) }) })]));
  });

  it('keeps existing variants visible while adding another with Enter', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: graph() }, company, save);
    const editor = root.querySelector<HTMLElement>('[data-alias-editor]')!;
    const aliasInput = editor.querySelector<HTMLInputElement>('[data-alias-input]')!;
    expect(aliasInput.closest('label')).toBeNull();
    root.querySelector<HTMLElement>('.pmd-alias-pill')!.click();
    expect(input('aliases').value).toBe('ZETABIO');
    editor.click();
    expect(dom.window.document.activeElement).toBe(aliasInput);
    aliasInput.value = 'Société Exemple';
    aliasInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(aliasInput.value).toBe('');
    expect(Array.from(editor.querySelectorAll('.pmd-alias-pill')).map((pill) => pill.firstChild!.textContent)).toEqual(['ZETABIO', 'Société Exemple']);
    expect(save).not.toHaveBeenCalled();
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'upsertNode', node: expect.objectContaining({ aliases: ['ZETABIO', 'Société Exemple'] }) })]));
  });

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
      { op: 'unlink', link: { fromNodeId: company.id, toNodeId: address.id, relation: 'adresse' } },
      { op: 'link', link: { fromNodeId: company.id, toNodeId: otherAddress.id, relation: 'adresse' } },
      { op: 'syncPartyCode', nodeId: company.id, customCode: 'ENTITE_EXEMPLE_07' },
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
      expect.objectContaining({ op: 'upsertNode', node: expect.objectContaining({ id: company.id, data: expect.objectContaining({ code, legalForm: 'SAS', partySide: 'adversaire', position: 'appelant' }) }) }),
      { op: 'syncPartyCode', nodeId: company.id, customCode: 'ENTITE_EXEMPLE_07' },
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

  it.each([false, true])('only unlinks through the cross (remove: %s)', async (remove) => {
    const snapshot = graph();
    const personId = 'entity:PERSONNE_PHYSIQUE_01';
    snapshot.nodes.push({ ...company, id: personId, kind: 'person', label: 'Jean Dupont', aliases: [], data: {} });
    snapshot.links.push({ projectId: company.projectId, fromNodeId: company.id, toNodeId: personId, relation: 'dirigeant', data: {} });
    const save = vi.fn().mockResolvedValue(undefined);
    nodeEditor(root, { graph: snapshot }, company, save);
    root.querySelector<HTMLElement>('.pmd-relation-target')!.click();
    expect(root.querySelector('.pmd-relation-row')).not.toBeNull();
    if (remove) {
      root.querySelector<HTMLButtonElement>('[data-unlink]')!.click();
      expect(root.querySelector('.pmd-relation-row')).toBeNull();
    }
    submit();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    const unlinks = save.mock.calls[0][0].filter((operation: { op: string }) => operation.op === 'unlink');
    expect(unlinks).toEqual(remove ? [{ op: 'unlink', link: { fromNodeId: company.id, toNodeId: personId, relation: 'dirigeant' } }] : []);
  });
});
