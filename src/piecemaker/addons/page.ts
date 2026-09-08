import { useSyncExternalStore } from 'react';

export const ADDONS_PAGES = [
  { path: '/library', id: 'library', icon: 'library' },
  { path: '/tabular-reviews', id: 'tabularReview', icon: 'tabular-review' },
  { path: '/workflows', id: 'workflows', icon: 'workflow' },
  { path: '/organisation', id: 'organisation', icon: 'organization' },
] as const;

let page: string | null = null;
const listeners = new Set<() => void>();

export function setAddonsPage(next: string | null) {
  page = next;
  listeners.forEach((listener) => listener());
}
export function readAddonsPage() { return page; }
export function subscribeAddonsPage(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useAddonsPage() { return useSyncExternalStore(subscribeAddonsPage, readAddonsPage); }
