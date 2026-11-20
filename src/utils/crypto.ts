/**
 * Chiffrement de bout en bout (E2EE) côté client via Web Crypto API (AES-256-GCM + PBKDF2-SHA256).
 * Aucune donnée budgétaire en clair ni aucune clé de foyer en clair ne transite vers Firestore.
 */

const AES_ALGO = 'AES-GCM';
const KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 250_000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function generateRandomId(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const id = bytesToBase64Url(bytes);
  return prefix ? `${prefix}_${id}` : id;
}

/** Génère un code secret lisible pour les invitations (128 bits d'entropie). */
export function generateInviteSecret(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let raw = '';
  for (let i = 0; i < bytes.length; i++) {
    raw += alphabet[bytes[i] % alphabet.length];
  }
  return `${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12, 18)}-${raw.slice(18, 24)}`;
}

/** Génère une nouvelle clé AES-256-GCM pour un foyer. */
export async function generateHouseholdKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: AES_ALGO, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportKeyBase64Url(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToBase64Url(new Uint8Array(raw));
}

export async function importKeyBase64Url(b64url: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(b64url.trim());
  if (raw.byteLength !== 32) {
    throw new Error('Clé de foyer invalide (longueur attendue : 256 bits).');
  }
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(raw),
    { name: AES_ALGO, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

async function deriveWrappingKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret.trim()),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: AES_ALGO, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface WrappedKeyBlob {
  wrappedKey: string;
  iv: string;
  salt: string;
}

/** Chiffre la clé du foyer (HDK) avec un secret (code d'invitation ou phrase secrète). */
export async function wrapHouseholdKey(hdk: CryptoKey, secret: string): Promise<WrappedKeyBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(secret, salt);
  const rawHdk = await crypto.subtle.exportKey('raw', hdk);
  const encrypted = await crypto.subtle.encrypt(
    { name: AES_ALGO, iv: toArrayBuffer(iv) },
    wrappingKey,
    rawHdk
  );
  return {
    wrappedKey: bytesToBase64Url(new Uint8Array(encrypted)),
    iv: bytesToBase64Url(iv),
    salt: bytesToBase64Url(salt),
  };
}

/** Déchiffre la clé du foyer (HDK) à partir d'un secret (code d'invitation ou phrase secrète). */
export async function unwrapHouseholdKey(blob: WrappedKeyBlob, secret: string): Promise<CryptoKey> {
  const salt = base64UrlToBytes(blob.salt);
  const iv = base64UrlToBytes(blob.iv);
  const encrypted = base64UrlToBytes(blob.wrappedKey);
  const wrappingKey = await deriveWrappingKey(secret, salt);
  const rawHdk = await crypto.subtle.decrypt(
    { name: AES_ALGO, iv: toArrayBuffer(iv) },
    wrappingKey,
    toArrayBuffer(encrypted)
  );
  return crypto.subtle.importKey(
    'raw',
    rawHdk,
    { name: AES_ALGO, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
  version: number;
}

/** Chiffre l'état complet du budget avec la clé du foyer. */
export async function encryptPayload<T>(data: T, hdk: CryptoKey): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = textEncoder.encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt(
    { name: AES_ALGO, iv: toArrayBuffer(iv) },
    hdk,
    plaintext
  );
  return {
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    version: 1,
  };
}

/** Déchiffre l'état du budget avec la clé du foyer. */
export async function decryptPayload<T>(payload: EncryptedPayload, hdk: CryptoKey): Promise<T> {
  const iv = base64UrlToBytes(payload.iv);
  const ciphertext = base64UrlToBytes(payload.ciphertext);
  const decrypted = await crypto.subtle.decrypt(
    { name: AES_ALGO, iv: toArrayBuffer(iv) },
    hdk,
    toArrayBuffer(ciphertext)
  );
  return JSON.parse(textDecoder.decode(decrypted)) as T;
}
