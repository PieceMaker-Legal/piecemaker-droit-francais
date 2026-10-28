export const NAME = /^[\p{L}_][\p{L}\p{N}_'’.-]*(?: [\p{L}\p{N}_'’.-]+)*$/u;

export const CONTROLS = { applicabilite: 'applicabilité', decompte: 'décompte', validite: 'validité', prescription: 'prescription' } as const;
export type ControlSlot = keyof typeof CONTROLS;
export const isControlName = (name: string, slot?: ControlSlot) => (slot ? [CONTROLS[slot]] : Object.values(CONTROLS)).some((stem) => name.startsWith(`${stem} `) || name.startsWith(`${stem}_`));

const LINKS: Record<string, string> = { et: 'Écris deux conditions sous si.', ou: 'Écris les deux faits sous l_une.', sauf: 'Écris l’exception sous sauf.' };
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'à', 'a', 'au', 'aux', 'en', 'dans', 'par', 'pour', 'sur', 'un', 'une']);

const words = (name: string) => name.toLowerCase().split(/[ _'’]+/).filter(Boolean);
const stem = (word: string) => {
  const plain = word.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /\d/.test(plain) ? plain : plain.replace(/[sx]$/, '').replace(/e$/, '').slice(0, 6);
};
const stems = (name: string) => new Set(words(name).filter((word) => !STOP.has(word)).map(stem));

export function adviseNames(names: string[]): Array<{ name: string; text: string }> {
  const advice: Array<{ name: string; text: string }> = [];
  const unique = [...new Set(names)];
  for (const name of unique) {
    const link = words(name).find((word) => Object.hasOwn(LINKS, word));
    if (link) advice.push({ name, text: `« ${name} » relie deux faits par « ${link} ». Un nom porte un seul fait. ${LINKS[link]}` });
  }
  for (const [index, first] of unique.entries()) {
    for (const second of unique.slice(index + 1)) {
      if (isControlName(first) !== isControlName(second)) continue;
      const [small, large] = [stems(first), stems(second)].sort((x, y) => x.size - y.size);
      const shared = [...small].every((item) => large.has(item));
      if (shared && (large.size === small.size || (small.size >= 3 && large.size === small.size + 1))) advice.push({ name: second, text: `« ${first} » et « ${second} » désignent peut-être le même fait. Si oui, garde un seul nom.` });
    }
  }
  return advice;
}

export const derivedName = (stem: string, rest: string, spaced: boolean) => (spaced ? `${stem} de ${rest.replace(/_/g, ' ')}` : `${stem}_de_${rest.replace(/ /g, '_')}`);
