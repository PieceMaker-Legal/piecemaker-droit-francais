import { useSyncExternalStore } from 'react';

export type CitationPassage = {
  quote: string;
  page?: number;
  nonce: number;
};

type StoredPassage = {
  keys: Set<string>;
  passage: CitationPassage;
};

const listeners = new Set<() => void>();
let current: StoredPassage | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function keysFor(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const keys = new Set<string>();
  const add = (value: string) => {
    keys.add(value);
    try {
      keys.add(decodeURIComponent(value));
    } catch {
      return;
    }
  };
  add(normalized);
  add(normalized.split('/').pop() ?? normalized);
  return keys;
}

export function setCitationPassage(path: string, quote: string, page?: number) {
  current = { keys: keysFor(path), passage: { quote, page, nonce: Date.now() } };
  notify();
}

export function clearCitationPassage() {
  if (!current) return;
  current = null;
  notify();
}

export function citationPassage(path: string): CitationPassage | null {
  if (!current) return null;
  for (const key of keysFor(path)) {
    if (current.keys.has(key)) return current.passage;
  }
  return null;
}

export function subscribeCitationPassages(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCitationPassage(path: string): CitationPassage | null {
  return useSyncExternalStore(subscribeCitationPassages, () => citationPassage(path), () => null);
}
