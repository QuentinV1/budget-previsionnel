import { describe, expect, it } from 'vitest';
import { createDefaultState } from '../../data/defaultData';
import {
  decryptPayload,
  encryptPayload,
  exportKeyBase64Url,
  generateHouseholdKey,
  generateInviteSecret,
  importKeyBase64Url,
  unwrapHouseholdKey,
  wrapHouseholdKey,
} from '../crypto';

describe('E2EE crypto (AES-256-GCM + PBKDF2)', () => {
  it('chiffre et déchiffre un BudgetState complet sans perte', async () => {
    const hdk = await generateHouseholdKey();
    const state = createDefaultState();
    const encrypted = await encryptPayload(state, hdk);

    expect(encrypted.ciphertext).not.toContain(state.householdName);
    expect(encrypted.iv.length).toBeGreaterThan(10);

    const decrypted = await decryptPayload<typeof state>(encrypted, hdk);
    expect(decrypted.householdName).toBe(state.householdName);
    expect(decrypted.lines.length).toBe(state.lines.length);
  });

  it('refuse le déchiffrement avec une mauvaise clé', async () => {
    const hdk1 = await generateHouseholdKey();
    const hdk2 = await generateHouseholdKey();
    const encrypted = await encryptPayload({ secret: 1234 }, hdk1);

    await expect(decryptPayload(encrypted, hdk2)).rejects.toThrow();
  });

  it('enveloppe et désenveloppe la clé du foyer via un secret d’invitation', async () => {
    const hdk = await generateHouseholdKey();
    const secret = generateInviteSecret();
    const wrapped = await wrapHouseholdKey(hdk, secret);

    const unwrapped = await unwrapHouseholdKey(wrapped, secret);
    const payload = await encryptPayload({ ok: true }, hdk);
    const decoded = await decryptPayload<{ ok: boolean }>(payload, unwrapped);
    expect(decoded.ok).toBe(true);

    await expect(unwrapHouseholdKey(wrapped, 'MAUVAIS-CODE')).rejects.toThrow();
  });

  it('exporte et réimporte la clé de secours en base64url', async () => {
    const hdk = await generateHouseholdKey();
    const b64 = await exportKeyBase64Url(hdk);
    const imported = await importKeyBase64Url(b64);

    const payload = await encryptPayload({ test: 'foyer' }, hdk);
    const decoded = await decryptPayload<{ test: string }>(payload, imported);
    expect(decoded.test).toBe('foyer');
  });
});
