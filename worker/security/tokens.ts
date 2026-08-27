const encoder = new TextEncoder();

const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
};

const randomBase64Url = (byteLength: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

export const createDeviceToken = (): string => randomBase64Url(32);

const PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const createPairingCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join('');
};

export const normalizePairingCode = (value: string): string =>
  value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/gu, '');

export const secretsMatch = async (provided: string, expected: string): Promise<boolean> => {
  const [providedHash, expectedHash] = await Promise.all([sha256(provided), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= providedHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
};
