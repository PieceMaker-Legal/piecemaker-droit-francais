import { createContext } from 'react';

export const DocxSaveContext = createContext<((save: () => Promise<boolean>) => () => void) | null>(null);
