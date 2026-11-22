import { exportKeyBase64Url, importKeyBase64Url } from './crypto';

const KEY_PREFIX = 'budget-foyer:e2ee-key:';
const ACTIVE_HOUSEHOLD_PREFIX = 'budget-foyer:active-household:';

function cacheKey(uid: string, householdId: string): string {
  return `${KEY_PREFIX}${uid}:${householdId}`;
}

export async function saveCachedHouseholdKey(uid: string, householdId: string, hdk: CryptoKey): Promise<void> {
  try {
    const b64 = await exportKeyBase64Url(hdk);
    localStorage.setItem(cacheKey(uid, householdId), b64);
  } catch {
    /* ignore storage quota */
  }
}

export async function loadCachedHouseholdKey(uid: string, householdId: string): Promise<CryptoKey | null> {
  try {
    const b64 = localStorage.getItem(cacheKey(uid, householdId));
    if (!b64) return null;
    return await importKeyBase64Url(b64);
  } catch {
    return null;
  }
}

export function removeCachedHouseholdKey(uid: string, householdId: string): void {
  try {
    localStorage.removeItem(cacheKey(uid, householdId));
  } catch {
    /* ignore */
  }
}

/** Efface toutes les clés E2EE en cache lors de la déconnexion (protection des données sensibles). */
export function clearAllCachedKeys(uid?: string): void {
  try {
    const toRemove: string[] = [];
    const targetPrefix = uid ? `${KEY_PREFIX}${uid}:` : KEY_PREFIX;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(targetPrefix) || (uid ? k === `${ACTIVE_HOUSEHOLD_PREFIX}${uid}` : k.startsWith(ACTIVE_HOUSEHOLD_PREFIX)))) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function getActiveHouseholdId(uid: string): string | null {
  try {
    return localStorage.getItem(`${ACTIVE_HOUSEHOLD_PREFIX}${uid}`);
  } catch {
    return null;
  }
}

export function setActiveHouseholdId(uid: string, householdId: string): void {
  try {
    localStorage.setItem(`${ACTIVE_HOUSEHOLD_PREFIX}${uid}`, householdId);
  } catch {
    /* ignore */
  }
}

export function clearActiveHouseholdId(uid: string): void {
  try {
    localStorage.removeItem(`${ACTIVE_HOUSEHOLD_PREFIX}${uid}`);
  } catch {
    /* ignore */
  }
}
