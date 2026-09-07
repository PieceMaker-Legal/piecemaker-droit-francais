import { useSyncExternalStore } from 'react';

export const MIKE_PAGES = [
  { path: '/workflows', title: 'Workflows', icon: 'workflow' },
  { path: '/workflow-addons', title: 'Add-ons', icon: 'workflow' },
  { path: '/tabular-reviews', title: 'Tabular review', icon: 'tabular-review' },
  { path: '/library', title: 'Library', icon: 'library' },
  { path: '/organisation', title: 'Organisation', icon: 'organization' },
] as const;

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
