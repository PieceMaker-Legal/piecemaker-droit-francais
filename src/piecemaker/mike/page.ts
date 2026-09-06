/**
 * Page Mike ouverte, partagée entre les entrées de navigation injectées dans la
 * barre latérale et la visionneuse montée dans l'arbre React de CloudCLI.
 */
import { useSyncExternalStore } from 'react';

let page: string | null = null;
const listeners = new Set<() => void>();

export function setMikePage(next: string | null) {
  page = next;
  listeners.forEach((listener) => listener());
}
export function readMikePage() { return page; }
export function subscribeMikePage(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useMikePage() { return useSyncExternalStore(subscribeMikePage, readMikePage); }
