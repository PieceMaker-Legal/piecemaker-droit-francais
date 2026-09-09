const LEGAL_FORM_TOKENS = new Set([
  'SELARL', 'SELAS', 'SELCA', 'SELCS', 'SASU', 'SARL', 'EURL', 'EARL',
  'SCOP', 'SCIC', 'GAEC', 'SAS', 'SCI', 'SCA', 'SCS', 'SCP', 'SCM', 'SNC',
  'GIE', 'SLP', 'SEL', 'SEM', 'EEIG', 'CIC', 'CIO', 'CLG', 'RTM', 'PLC', 'LTD',
  'LLLP', 'PLLC', 'LLC', 'LLP', 'INC', 'CORP', 'LP', 'GP', 'PC', 'PA', 'CO',
  'PARTG', 'GMBH', 'KGAA', 'OHG', 'GBR', 'KG', 'AG', 'UG', 'EG', 'EK',
  'SE', 'SA', 'BV', 'NV', 'SPA', 'SRL', 'SL', 'LDA', 'AB', 'OY', 'APS', 'AS',
  'PTYLTD', 'PVTLTD',
]);

export type MappingGroup = {
  code: string;
  principal: string;
  variants: string[];
};

export type MappingAssignment = {
  field: string;
  code: string;
  original_code: string;
  category: string;
  principal: string;
  variants: string[];
};

export type ProcedureParty = {
  type: 'personne_physique' | 'societe';
  position: string;
  position_libelle: string;
  civilite: string;
  nom: string;
  date_naissance: string;
  lieu_naissance: string;
  adresse: string;
  societe_nom: string;
  forme_sociale: string;
  siren: string;
  siege_social: string;
  representant: string;
  mapping_assignments: MappingAssignment[];
};

export type ProfileRelationship = {
  id: string;
  source: string;
  target: string;
  role: string;
};

export type ProcedureInfo = {
  parties_clientes: ProcedureParty[];
  parties_adverses: ProcedureParty[];
  relations: ProfileRelationship[];
};

export type MappingDocument = {
  mapping: Record<string, string>;
  reverse_mapping: Record<string, string[]>;
  informations_dossier: ProcedureInfo;
};

export const PROCEDURE_POSITIONS = [
  { value: 'demandeur', label: 'Demandeur' },
  { value: 'defendeur', label: 'Défendeur' },
  { value: 'appelant', label: 'Appelant' },
  { value: 'intime', label: 'Intimé' },
  { value: 'requerant', label: 'Requérant' },
  { value: 'mis_en_cause', label: 'Mis en cause' },
  { value: 'intervenant', label: 'Intervenant' },
  { value: 'autre', label: 'Autre' },
] as const;

const PROCEDURE_POSITION_VALUES = new Set<string>(PROCEDURE_POSITIONS.map(({ value }) => value));

function clean(value: unknown): string {
  return String(value || '').trim();
}

function unique(values: unknown[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function normalized(value: unknown): string {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
}

function preferredVariant(variants: string[], reverseValue: string[] | string | undefined): string {
  const preferred = clean(Array.isArray(reverseValue) ? reverseValue[0] : reverseValue);
  if (preferred && variants.includes(preferred)) return preferred;
  return variants.find((variant) => variant === variant.toUpperCase())
    || variants.find((variant) => variant[0] === variant[0].toUpperCase())
    || variants[0];
}

function codeToken(value: unknown, fallback = 'AUTRE'): string {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

function isSocieteCode(code: unknown): boolean {
  const normalizedCode = String(code || '').replace(/\s+/g, '_').toUpperCase();
  if (normalizedCode.includes('MORALE') || normalizedCode.includes('SOCIETE')) return true;
  return normalizedCode.replace(/_\d+$/, '').split('_').filter(Boolean).some((token) => LEGAL_FORM_TOKENS.has(token));
}

function partyCategoryForCode(code: unknown): string {
  const value = codeToken(code);
  if (value.startsWith('SIREN_')) return 'siren';
  if (value.startsWith('ADRESSE_') || value.startsWith('LIEU_NAISSANCE_')) return 'adresses';
  if (value.includes('PERSONNE_PHYSIQUE') || value.startsWith('DIRIGEANT_')) return 'personnes_physiques';
  if (isSocieteCode(value)) return 'societes';
  return 'autres';
}

function normalizeAssignments(value: unknown): MappingAssignment[] {
  if (!Array.isArray(value)) return [];
  return value.map((candidate) => {
    const assignment = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
    return {
      field: clean(assignment.field),
      code: clean(assignment.code),
      original_code: clean(assignment.original_code),
      category: clean(assignment.category) || partyCategoryForCode(assignment.code),
      principal: clean(assignment.principal),
      variants: unique(Array.isArray(assignment.variants) ? assignment.variants : []),
    };
  }).filter((assignment) => assignment.code && assignment.variants.length);
}

export function profileRelationshipId(source: unknown, target: unknown, role: unknown): string {
  return `relation:${clean(source)}\u0000${clean(target)}\u0000${clean(role)}`;
}

function normalizeRelationships(value: unknown): ProfileRelationship[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenRelationships = new Set<string>();
  return value.flatMap((candidate) => {
    const relation = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
    const source = clean(relation.source);
    const target = clean(relation.target);
    const role = clean(relation.role);
    const relationshipKey = `${source}\u0000${target}\u0000${role}`;
    const id = clean(relation.id) || profileRelationshipId(source, target, role);
    if (!source || !target || !role || source === target || seenIds.has(id) || seenRelationships.has(relationshipKey)) return [];
    seenIds.add(id);
    seenRelationships.add(relationshipKey);
    return [{ id, source, target, role }];
  });
}

function normalizeParty(raw: unknown, side: 'client' | 'adversaire'): ProcedureParty {
  const party = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const type = party.type === 'societe' ? 'societe' : 'personne_physique';
  const fallbackPosition = side === 'client' ? 'demandeur' : 'defendeur';
  const position = PROCEDURE_POSITION_VALUES.has(clean(party.position)) ? clean(party.position) : fallbackPosition;
  return {
    type,
    position,
    position_libelle: position === 'autre' ? clean(party.position_libelle) : '',
    civilite: type === 'personne_physique' ? clean(party.civilite) : '',
    nom: type === 'personne_physique' ? clean(party.nom) : '',
    date_naissance: type === 'personne_physique' ? clean(party.date_naissance) : '',
    lieu_naissance: type === 'personne_physique' ? clean(party.lieu_naissance) : '',
    adresse: type === 'personne_physique' ? clean(party.adresse) : '',
    societe_nom: type === 'societe' ? clean(party.societe_nom) : '',
    forme_sociale: type === 'societe' ? clean(party.forme_sociale) : '',
    siren: type === 'societe' ? clean(party.siren) : '',
    siege_social: type === 'societe' ? clean(party.siege_social) : '',
    representant: type === 'societe' ? clean(party.representant) : '',
    mapping_assignments: normalizeAssignments(party.mapping_assignments),
  };
}

export function emptyProcedureParty(side: 'client' | 'adversaire'): ProcedureParty {
  return normalizeParty({}, side);
}

export function groupMappingByCode(
  mapping: Record<string, string> = {},
  reverseMapping: Record<string, string[]> = {},
): MappingGroup[] {
  const codeToVariants = new Map<string, string[]>();
  for (const [rawVariant, rawCode] of Object.entries(mapping || {})) {
    const variant = clean(rawVariant);
    const code = clean(rawCode);
    if (!variant || !code) continue;
    if (!codeToVariants.has(code)) codeToVariants.set(code, []);
    const variants = codeToVariants.get(code)!;
    if (!variants.includes(variant)) variants.push(variant);
  }
  return [...codeToVariants].map(([code, variants]) => {
    const principal = preferredVariant(variants, reverseMapping?.[code]);
    return { code, principal, variants: variants.filter((variant) => variant !== principal) };
  });
}

export class MappingValidationError extends Error {
  readonly rowIndex?: number;
  readonly field?: string;
  readonly variant?: string;

  constructor(message: string, details: { rowIndex?: number; field?: string; variant?: string } = {}) {
    super(message);
    this.name = 'MappingValidationError';
    this.rowIndex = details.rowIndex;
    this.field = details.field;
    this.variant = details.variant;
  }
}

export function buildMappingDocument(groups: MappingGroup[] = []): Pick<MappingDocument, 'mapping' | 'reverse_mapping'> {
  const mapping: Record<string, string> = {};
  const reverseMapping: Record<string, string[]> = {};
  const codeRows = new Map<string, number>();
  const variantCodes = new Map<string, string>();
  groups.forEach((group, rowIndex) => {
    const code = clean(group?.code);
    const principal = clean(group?.principal);
    const otherVariants = Array.isArray(group?.variants) ? group.variants : [];
    if (!code && !principal && !otherVariants.some((variant) => clean(variant))) return;
    if (!code) throw new MappingValidationError('Chaque entrée demande un nom anonymisé.', { rowIndex, field: 'code' });
    if (!principal) throw new MappingValidationError('Chaque entrée demande un variant principal pour le revert.', { rowIndex, field: 'principal' });
    if (codeRows.has(code)) throw new MappingValidationError(`Le nom anonymisé « ${code} » apparaît sur plusieurs lignes.`, { rowIndex, field: 'code' });
    const variants = unique([principal, ...otherVariants]);
    for (const variant of variants) {
      const previousCode = variantCodes.get(variant);
      if (previousCode && previousCode !== code) {
        throw new MappingValidationError(`Le variant « ${variant} » est déjà attribué au nom anonymisé « ${previousCode} ».`, {
          rowIndex,
          field: variant === principal ? 'principal' : 'variant',
          variant,
        });
      }
      mapping[variant] = code;
      variantCodes.set(variant, code);
    }
    reverseMapping[code] = variants;
    codeRows.set(code, rowIndex);
  });
  return { mapping, reverse_mapping: reverseMapping };
}

export function normalizeProcedureInfo(info: unknown = {}): ProcedureInfo {
  const source = info && typeof info === 'object' && !Array.isArray(info) ? info as Record<string, unknown> : {};
  return {
    parties_clientes: (Array.isArray(source.parties_clientes) ? source.parties_clientes : []).map((party) => normalizeParty(party, 'client')),
    parties_adverses: (Array.isArray(source.parties_adverses) ? source.parties_adverses : []).map((party) => normalizeParty(party, 'adversaire')),
    relations: normalizeRelationships(source.relations),
  };
}

export function partyDisplayName(party: ProcedureParty): string {
  if (party?.type === 'societe') return [clean(party.forme_sociale), clean(party.societe_nom)].filter(Boolean).join(' ');
  const name = clean(party?.nom);
  const title = clean(party?.civilite);
  return title && !normalized(name).startsWith(`${normalized(title)} `) ? `${title} ${name}`.trim() : name;
}

export function procedureSummary(info: unknown = {}): { client: string[]; adverse: string[] } {
  const normalizedInfo = normalizeProcedureInfo(info);
  const names = (parties: ProcedureParty[]) => parties.map(partyDisplayName).filter(Boolean);
  return { client: names(normalizedInfo.parties_clientes), adverse: names(normalizedInfo.parties_adverses) };
}

export function principalPartyOptions(
  mapping: Record<string, string> = {},
  reverseMapping: Record<string, string[]> = {},
  type: ProcedureParty['type'] = 'personne_physique',
): Array<{ code: string; principal: string }> {
  const expected = type === 'societe' ? 'societes' : 'personnes_physiques';
  return groupMappingByCode(mapping, reverseMapping)
    .filter((group) => partyCategoryForCode(group.code) === expected)
    .map(({ code, principal }) => ({ code, principal }));
}

function nextGenericCode(category: string, codes: Set<string>): string {
  const prefix = ({ personnes_physiques: 'PERSONNE_PHYSIQUE', societes: 'PERSONNE_MORALE', adresses: 'ADRESSE', siren: 'SIREN', autres: 'AUTRE' } as Record<string, string>)[category] || 'AUTRE';
  let highest = 0;
  for (const code of codes) {
    const match = new RegExp(`^${prefix}_(\\d+)$`).exec(code);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}_${String(highest + 1).padStart(2, '0')}`;
}

function restorePreviousAssignments(
  document: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>,
  previousInfo: unknown,
): Pick<MappingDocument, 'mapping' | 'reverse_mapping'> {
  const mapping = { ...document.mapping };
  const reverseMapping = { ...document.reverse_mapping };
  const info = normalizeProcedureInfo(previousInfo);
  for (const party of [...info.parties_clientes, ...info.parties_adverses]) {
    for (const assignment of party.mapping_assignments) {
      const variants = assignment.variants.filter((variant) => mapping[variant] === assignment.code);
      if (!variants.length) continue;
      const occupiedOutsideAssignment = assignment.original_code && Object.entries(mapping)
        .some(([variant, code]) => code === assignment.original_code && !variants.includes(variant));
      const restoredCode = assignment.original_code && !occupiedOutsideAssignment
        ? assignment.original_code
        : nextGenericCode(assignment.category, new Set(Object.values(mapping)));
      for (const variant of variants) mapping[variant] = restoredCode;
      reverseMapping[restoredCode] = unique([assignment.principal, ...variants]);
    }
  }
  return buildMappingDocument(groupMappingByCode(mapping, reverseMapping));
}

function findGroup(document: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>, value: unknown): MappingGroup | null {
  const needle = normalized(value);
  if (!needle) return null;
  const groups = groupMappingByCode(document.mapping, document.reverse_mapping);
  return groups.find((group) => normalized(group.principal) === needle)
    || groups.find((group) => group.variants.some((variant) => normalized(variant) === needle))
    || null;
}

function assignValue(
  document: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>,
  value: string,
  code: string,
  field: string,
  category: string,
  claimedVariants: Map<string, string>,
): MappingAssignment | null {
  const principal = clean(value);
  if (!principal) return null;
  const source = findGroup(document, principal);
  const variants = source ? unique([source.principal, ...source.variants]) : [principal];
  for (const variant of variants) {
    const previousClaim = claimedVariants.get(variant);
    if (previousClaim && previousClaim !== code) throw new MappingValidationError(`Le variant « ${variant} » ne peut pas identifier deux parties de la procédure.`, { field: 'party', variant });
    claimedVariants.set(variant, code);
    document.mapping[variant] = code;
  }
  document.reverse_mapping[code] = unique([principal, ...variants]);
  return { field, code, original_code: source?.code || '', category, principal, variants };
}

function partyRoleToken(party: ProcedureParty): string {
  return codeToken(party.position === 'autre' ? party.position_libelle : party.position);
}

function applySideAssignments(
  document: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>,
  parties: ProcedureParty[],
  side: 'client' | 'adversaire',
  claimedVariants: Map<string, string>,
): ProcedureParty[] {
  const sideToken = side === 'client' ? 'CLIENT' : 'ADVERSAIRE';
  return parties.map((party, index) => {
    const number = String(index + 1).padStart(2, '0');
    const prefix = `${sideToken}_${partyRoleToken(party)}`;
    const assignments: MappingAssignment[] = [];
    const add = (value: string, code: string, field: string, category: string) => {
      const assignment = assignValue(document, value, code, field, category, claimedVariants);
      if (assignment) assignments.push(assignment);
    };
    if (party.type === 'societe') {
      add(party.societe_nom, `${prefix}_PERSONNE_MORALE_${number}`, 'identite', 'societes');
      add(party.siren, `SIREN_${prefix}_${number}`, 'siren', 'siren');
      add(party.siege_social, `ADRESSE_${prefix}_${number}`, 'siege_social', 'adresses');
      add(party.representant, `DIRIGEANT_${prefix}_${number}`, 'representant', 'personnes_physiques');
    } else {
      add(party.nom, `${prefix}_PERSONNE_PHYSIQUE_${number}`, 'identite', 'personnes_physiques');
      add(party.date_naissance, `DATE_NAISSANCE_${prefix}_${number}`, 'date_naissance', 'autres');
      add(party.lieu_naissance, `LIEU_NAISSANCE_${prefix}_${number}`, 'lieu_naissance', 'adresses');
      add(party.adresse, `ADRESSE_${prefix}_${number}`, 'adresse', 'adresses');
    }
    return { ...party, mapping_assignments: assignments };
  });
}

function remapProfileRelationships(
  relationships: ProfileRelationship[],
  previousDocument: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>,
  nextDocument: Pick<MappingDocument, 'mapping' | 'reverse_mapping'>,
): ProfileRelationship[] {
  const replacements = new Map<string, string>();
  for (const group of groupMappingByCode(previousDocument.mapping, previousDocument.reverse_mapping)) {
    const replacement = clean(nextDocument.mapping[group.principal]);
    if (replacement && replacement !== group.code) replacements.set(group.code, replacement);
  }
  return relationships.map((relationship) => ({
    ...relationship,
    source: replacements.get(relationship.source) || relationship.source,
    target: replacements.get(relationship.target) || relationship.target,
  }));
}

export function applyProcedureParties(
  mappingDocument: Partial<MappingDocument> = {},
  previousInfo: unknown = {},
  nextInfo: unknown = {},
): MappingDocument {
  const base = buildMappingDocument(groupMappingByCode(mappingDocument.mapping || {}, mappingDocument.reverse_mapping || {}));
  const document = restorePreviousAssignments(base, previousInfo);
  const info = normalizeProcedureInfo(nextInfo);
  const claimedVariants = new Map<string, string>();
  const parties_clientes = applySideAssignments(document, info.parties_clientes, 'client', claimedVariants);
  const parties_adverses = applySideAssignments(document, info.parties_adverses, 'adversaire', claimedVariants);
  const rebuilt = buildMappingDocument(groupMappingByCode(document.mapping, document.reverse_mapping));
  const relations = remapProfileRelationships(info.relations, base, rebuilt);
  return { ...rebuilt, informations_dossier: { parties_clientes, parties_adverses, relations } };
}
