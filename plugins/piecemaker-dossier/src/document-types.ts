export type DocumentType = { name: string; icon: string };

export const DOCUMENT_ICONS: Record<string, { label: string; paths: string }> = {
  file: { label: 'Document', paths: '<path d="M14 2H6v20h12V6zM14 2v5h5M8 12h8M8 16h8"/>' },
  scroll: { label: 'Acte', paths: '<path d="M8 3h12v14a4 4 0 0 1-4 4H6a3 3 0 0 1-3-3v-2h10v2a3 3 0 0 0 6 0M8 16V6a3 3 0 0 0-6 0v2h6M11 7h5M11 11h5"/>' },
  pen: { label: 'Contrat', paths: '<path d="M12 3H4v18h16v-8M14 6l4-4 4 4-10 10-5 1 1-5zM15 5l4 4"/>' },
  mail: { label: 'Courrier', paths: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>' },
  at: { label: 'Courriel', paths: '<circle cx="12" cy="12" r="4"/><path d="M16 8v6a2 2 0 0 0 4 0v-2a8 8 0 1 0-3 6"/>' },
  alert: { label: 'Mise en demeure', paths: '<path d="m12 3 10 18H2zM12 9v5M12 17v1"/>' },
  receipt: { label: 'Facture', paths: '<path d="M5 3l2 1 2-1 3 1 3-1 2 1 2-1v18l-2-1-2 1-3-1-3 1-2-1-2 1zM9 8h6M9 12h6M9 16h3"/>' },
  calculator: { label: 'Devis', paths: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 10h1M12 10h1M16 10h1M8 14h1M12 14h1M16 14h1M8 18h1M12 18h5"/>' },
  badge: { label: 'Attestation', paths: '<circle cx="12" cy="8" r="5"/><path d="m8 12-1 10 5-3 5 3-1-10m-7-4 2 2 4-4"/>' },
  scale: { label: 'Justice', paths: '<path d="M12 3v18M5 21h14M3 7h18M5 7l-3 8h6zm14 0-3 8h6z"/>' },
  search: { label: 'Constat / expertise', paths: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6M10 7v6"/>' },
  building: { label: 'Société', paths: '<path d="M4 22V3h12v19M16 9h4v13M8 7h4M8 11h4M8 15h4M8 19h4"/>' },
  bank: { label: 'Banque', paths: '<path d="m12 2 10 6H2zM4 10v8M9 10v8M15 10v8M20 10v8M2 22h20M2 19h20"/>' },
  list: { label: 'Bordereau', paths: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>' },
  users: { label: 'Partie', paths: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 3a4 4 0 0 1 0 8M22 21v-2a7 7 0 0 0-4-6"/>' },
  diamond: { label: 'Prémisse', paths: '<path d="m12 2 10 10-10 10L2 12z"/>' },
};

export const DEFAULT_DOCUMENT_TYPES: DocumentType[] = [['legal document', 'scroll'], ['material entity', 'search']].map(([name, icon]) => ({ name, icon }));

export function documentTypeNames(types = DEFAULT_DOCUMENT_TYPES): string[] {
  return [...new Set([...types.map((type) => type.name), 'indéterminé'])];
}

export function documentIcon(name: string, types = DEFAULT_DOCUMENT_TYPES): string {
  const normalized = name.trim().toLocaleLowerCase('fr');
  return types.find((type) => type.name.toLocaleLowerCase('fr') === normalized)?.icon
    || types.filter((type) => normalized.startsWith(`${type.name.toLocaleLowerCase('fr')} `)).sort((a, b) => b.name.length - a.name.length)[0]?.icon
    || 'file';
}

export function iconSvg(icon: string, color = 'currentColor'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(DOCUMENT_ICONS[icon] || DOCUMENT_ICONS.file).paths}</svg>`;
}
