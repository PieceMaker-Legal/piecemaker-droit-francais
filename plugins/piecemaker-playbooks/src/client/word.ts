export function decodeBuffer(value: string): ArrayBuffer {
  const raw = atob(value);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0)).buffer;
}

export function encodeBuffer(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(raw);
}
