export type SourceInfo = { kind: 'texte' | 'decision' | 'piece'; title: string; text: string; validity?: { from: string; to: string | null }; history?: { statut: 'remise en cause' | 'à examiner' | 'non remise en cause'; details: string[] } };

export const OFFICIAL_ID = /^(?:(?:LEGIARTI|JORFARTI|KALIARTI|JURITEXT|CETATEXT|CONSTEXT)\d+|[0-9a-f]{24}|CELEX:\S+|ECLI:\S+)$/u;
export const ID_SHAPE = 'LEGIARTI… pour un article, JURITEXT… pour une décision judiciaire, 24 caractères hexadécimaux pour une décision Judilibre, CETATEXT… pour une décision administrative, CONSTEXT… pour une décision du Conseil constitutionnel, CELEX:… ou ECLI:… pour le droit de l’Union, chemin de la pièce pour une clause';

export type SourceConnectors = {
  source(cwd: string, id: string): Promise<SourceInfo | null | undefined>;
  match(text: string, excerpt: string): string | null;
  registry(query: { siren: string | null; name: string | null }): Promise<{ found: boolean; status: string }>;
  bodacc(siren: string): Promise<string[]>;
  premise?(cwd: string, title: string): { date: string; intitule: string; preuve: Array<{ piece: string; citation: string }> } | null;
};
