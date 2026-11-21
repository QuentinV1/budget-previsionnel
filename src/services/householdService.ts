import { User } from 'firebase/auth';
import {
  Timestamp,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { createDefaultState } from '../data/defaultData';
import { cleanForFirestore, db } from '../firebase';
import { BudgetState } from '../types';
import {
  EncryptedPayload,
  WrappedKeyBlob,
  decryptPayload,
  encryptPayload,
  exportKeyBase64Url,
  generateHouseholdKey,
  generateInviteSecret,
  generateRandomId,
  unwrapHouseholdKey,
  wrapHouseholdKey,
} from '../utils/crypto';
import { removeCachedHouseholdKey, saveCachedHouseholdKey } from '../utils/keyCache';
import { normalizeState } from '../utils/storage';

export interface HouseholdMember {
  uid: string;
  displayName: string;
  email: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface HouseholdDoc {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  members: Record<string, HouseholdMember>;
  encryptedPayload: EncryptedPayload;
  createdAt: string;
  updatedAt: string;
}

export interface InviteCreateResult {
  inviteId: string;
  inviteSecret: string;
  shareUrl: string;
}

function requireDb() {
  if (!db) throw new Error('Firestore non configuré.');
  return db;
}

function userLabel(user: User): string {
  const raw = user.displayName?.trim() || user.email?.split('@')[0] || 'Membre';
  return raw.slice(0, 80) || 'Membre';
}

export async function upsertUserProfile(user: User): Promise<void> {
  const firestore = requireDb();
  const ref = doc(firestore, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: (user.email ?? '').slice(0, 120),
      displayName: userLabel(user),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(ref, {
      email: (user.email ?? '').slice(0, 120),
      displayName: userLabel(user),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function listUserHouseholds(uid: string): Promise<HouseholdDoc[]> {
  const firestore = requireDb();
  const q = query(collection(firestore, 'households'), where('memberIds', 'array-contains', uid));
  const snap = await getDocs(q);
  const list: HouseholdDoc[] = [];
  snap.forEach((d) => {
    list.push({ id: d.id, ...(d.data() as Omit<HouseholdDoc, 'id'>) });
  });
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return list;
}

export function subscribeUserHouseholds(
  uid: string,
  onUpdate: (list: HouseholdDoc[], fromCache: boolean) => void,
  onError: (err: unknown) => void
): () => void {
  const firestore = requireDb();
  const q = query(collection(firestore, 'households'), where('memberIds', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: HouseholdDoc[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...(d.data() as Omit<HouseholdDoc, 'id'>) });
      });
      list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      onUpdate(list, snap.metadata.fromCache);
    },
    (err) => onError(err)
  );
}

export function subscribeHousehold(
  householdId: string,
  onData: (docData: HouseholdDoc | null, fromCache: boolean) => void,
  onError: (err: unknown) => void
): () => void {
  const firestore = requireDb();
  return onSnapshot(
    doc(firestore, 'households', householdId),
    (snap) => {
      if (!snap.exists()) {
        onData(null, snap.metadata.fromCache);
        return;
      }
      onData({ id: snap.id, ...(snap.data() as Omit<HouseholdDoc, 'id'>) }, snap.metadata.fromCache);
    },
    (err) => onError(err)
  );
}

const DEFAULT_DEMO_STATE = createDefaultState();
const DEFAULT_DEMO_IDS = new Set<string>([
  ...DEFAULT_DEMO_STATE.sheets.map((s) => String(s.id)),
  ...DEFAULT_DEMO_STATE.lines.map((l) => String(l.id)),
  ...DEFAULT_DEMO_STATE.categories.map((c) => String(c.id)),
  ...DEFAULT_DEMO_STATE.accounts.map((a) => String(a.id)),
  ...DEFAULT_DEMO_STATE.goals.map((g) => String(g.id)),
  ...DEFAULT_DEMO_STATE.loans.map((l) => String(l.id)),
  ...DEFAULT_DEMO_STATE.levers.map((l) => String(l.id)),
]);

/**
 * Fusionne l'état serveur et les éléments locaux absents du serveur
 * lors d'une première connexion sur un nouvel appareil/compte (modèle app-charcuterie).
 */
export function mergeBudgetStates(
  serverState: BudgetState,
  localState: BudgetState
): { merged: BudgetState; hasLocalAdditions: boolean } {
  let hasLocalAdditions = false;

  const mergeById = <T extends { id: string }>(serverArr: T[] = [], localArr: T[] = []): T[] => {
    const serverIds = new Set(serverArr.map((item) => String(item.id)));
    const localOnly = localArr.filter(
      (item) =>
        item &&
        item.id &&
        !serverIds.has(String(item.id)) &&
        !DEFAULT_DEMO_IDS.has(String(item.id))
    );
    if (localOnly.length > 0) {
      hasLocalAdditions = true;
    }
    return [...serverArr, ...localOnly];
  };

  const mergedLines = mergeById(serverState.lines, localState.lines);
  const mergedCategories = mergeById(serverState.categories, localState.categories);
  const mergedAccounts = mergeById(serverState.accounts, localState.accounts);
  const mergedGoals = mergeById(serverState.goals ?? [], localState.goals ?? []);
  const mergedLoans = mergeById(serverState.loans, localState.loans);
  const mergedLevers = mergeById(serverState.levers, localState.levers);

  // Inclure les feuilles locales personnalisées ou référencées par des éléments ajoutés
  const referencedSheetIds = new Set<string>([
    ...mergedLines.map((l) => l.sheetId),
    ...mergedAccounts.map((a) => a.ownerId),
    ...mergedLoans.map((l) => l.ownerId),
  ]);
  const serverSheetIds = new Set(serverState.sheets.map((s) => String(s.id)));
  const localOnlySheets = (localState.sheets || []).filter(
    (s) =>
      s &&
      s.id &&
      !serverSheetIds.has(String(s.id)) &&
      (!DEFAULT_DEMO_IDS.has(String(s.id)) || referencedSheetIds.has(String(s.id)))
  );
  if (localOnlySheets.length > 0) {
    hasLocalAdditions = true;
  }
  const mergedSheets = [...serverState.sheets, ...localOnlySheets];

  // Suivi mensuel par mois (month = YYYY-MM)
  const serverMonths = new Set((serverState.monthlyRecords ?? []).map((r) => String(r.month)));
  const localOnlyRecords = (localState.monthlyRecords ?? []).filter(
    (r) => r && r.month && !serverMonths.has(String(r.month))
  );
  if (localOnlyRecords.length > 0) {
    hasLocalAdditions = true;
  }
  const mergedRecords = [...(serverState.monthlyRecords ?? []), ...localOnlyRecords];

  const merged = normalizeState({
    ...serverState,
    sheets: mergedSheets,
    lines: mergedLines,
    categories: mergedCategories,
    accounts: mergedAccounts,
    goals: mergedGoals,
    loans: mergedLoans,
    levers: mergedLevers,
    monthlyRecords: mergedRecords,
  });

  return { merged, hasLocalAdditions };
}

export async function createHousehold(
  user: User,
  name: string,
  initialState: BudgetState,
  passphrase?: string
): Promise<{ householdId: string; hdk: CryptoKey; recoveryKey: string; doc: HouseholdDoc }> {
  const firestore = requireDb();
  const householdId = generateRandomId('foyer');
  const hdk = await generateHouseholdKey();
  const cleanName = name.trim().slice(0, 80) || 'Mon Foyer';
  const now = new Date().toISOString();

  const stateToEncrypt: BudgetState = cleanForFirestore({
    ...initialState,
    householdName: cleanName,
    updatedAt: now,
  });
  const encryptedPayload = await encryptPayload(stateToEncrypt, hdk);

  const member: HouseholdMember = {
    uid: user.uid,
    displayName: userLabel(user),
    email: (user.email ?? '').slice(0, 320),
    role: 'owner',
    joinedAt: now,
  };

  const payloadDoc: Omit<HouseholdDoc, 'id'> = {
    name: cleanName,
    ownerId: user.uid,
    memberIds: [user.uid],
    members: { [user.uid]: member },
    encryptedPayload,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(firestore, 'households', householdId), cleanForFirestore(payloadDoc));

  await saveCachedHouseholdKey(user.uid, householdId, hdk);
  if (passphrase && passphrase.trim().length >= 6) {
    await savePassphraseVault(user.uid, householdId, hdk, passphrase);
  }

  const recoveryKey = await exportKeyBase64Url(hdk);
  return {
    householdId,
    hdk,
    recoveryKey,
    doc: { id: householdId, ...payloadDoc },
  };
}

export async function saveHouseholdBudget(
  householdId: string,
  uid: string,
  state: BudgetState,
  hdk: CryptoKey
): Promise<EncryptedPayload> {
  const firestore = requireDb();
  const now = new Date().toISOString();
  const cleanState = cleanForFirestore({ ...state, updatedAt: now });
  const encryptedPayload = await encryptPayload(cleanState, hdk);
  await updateDoc(doc(firestore, 'households', householdId), {
    name: state.householdName.trim().slice(0, 80) || 'Mon Foyer',
    encryptedPayload: { ...encryptedPayload, updatedAt: now, updatedBy: uid },
    updatedAt: now,
  });
  return encryptedPayload;
}

export async function decryptHouseholdState(
  household: HouseholdDoc,
  hdk: CryptoKey
): Promise<BudgetState> {
  const raw = await decryptPayload<BudgetState>(household.encryptedPayload, hdk);
  return normalizeState(raw);
}

export async function savePassphraseVault(
  uid: string,
  householdId: string,
  hdk: CryptoKey,
  passphrase: string
): Promise<void> {
  const firestore = requireDb();
  const wrapped = await wrapHouseholdKey(hdk, passphrase);
  await setDoc(
    doc(firestore, 'users', uid, 'keyVault', householdId),
    cleanForFirestore({
      ...wrapped,
      mode: 'passphrase',
      updatedAt: new Date().toISOString(),
    })
  );
}

export async function hasPassphraseVault(uid: string, householdId: string): Promise<boolean> {
  const firestore = requireDb();
  const snap = await getDoc(doc(firestore, 'users', uid, 'keyVault', householdId));
  return snap.exists();
}

export async function unlockFromPassphraseVault(
  uid: string,
  householdId: string,
  passphrase: string
): Promise<CryptoKey> {
  const firestore = requireDb();
  const snap = await getDoc(doc(firestore, 'users', uid, 'keyVault', householdId));
  if (!snap.exists()) {
    throw new Error('Aucun coffre-fort trouvé pour ce foyer. Utilisez la clé de secours.');
  }
  const data = snap.data() as WrappedKeyBlob;
  const hdk = await unwrapHouseholdKey(data, passphrase);
  await saveCachedHouseholdKey(uid, householdId, hdk);
  return hdk;
}

export async function createHouseholdInvite(
  householdId: string,
  householdName: string,
  user: User,
  hdk: CryptoKey,
  maxUses = 5,
  expiresInDays = 7
): Promise<InviteCreateResult> {
  const firestore = requireDb();
  const inviteId = generateRandomId('inv');
  const inviteSecret = generateInviteSecret();
  const wrapped = await wrapHouseholdKey(hdk, inviteSecret);
  const now = new Date();
  const expiresAt = Timestamp.fromDate(new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000));

  await setDoc(doc(firestore, 'invites', inviteId), {
    householdId,
    householdName: householdName.trim().slice(0, 80) || 'Mon Foyer',
    createdBy: user.uid,
    wrappedHdk: wrapped.wrappedKey,
    iv: wrapped.iv,
    salt: wrapped.salt,
    revoked: false,
    maxUses,
    usedCount: 0,
    usedBy: [],
    createdAt: now.toISOString(),
    expiresAt,
  });

  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const shareUrl = `${baseUrl}#/join?invite=${encodeURIComponent(inviteId)}&key=${encodeURIComponent(inviteSecret)}`;
  return { inviteId, inviteSecret, shareUrl };
}

export async function redeemHouseholdInvite(
  user: User,
  inviteId: string,
  inviteSecret: string
): Promise<{ householdId: string; householdName: string; hdk: CryptoKey }> {
  const firestore = requireDb();
  const cleanInviteId = inviteId.trim();
  const inviteRef = doc(firestore, 'invites', cleanInviteId);
  const inviteSnap = await getDoc(inviteRef);

  if (!inviteSnap.exists()) {
    throw new Error('Invitation introuvable ou expirée.');
  }

  const inv = inviteSnap.data() as {
    householdId: string;
    householdName: string;
    wrappedHdk: string;
    iv: string;
    salt: string;
    revoked: boolean;
    maxUses: number;
    usedCount: number;
    usedBy: string[];
    expiresAt: Timestamp;
  };

  if (inv.revoked) throw new Error('Cette invitation a été révoquée.');
  if (inv.expiresAt.toDate().getTime() < Date.now()) throw new Error('Cette invitation a expiré.');
  if (inv.usedCount >= inv.maxUses) throw new Error('Cette invitation a atteint son nombre maximum d’utilisations.');

  let hdk: CryptoKey;
  try {
    hdk = await unwrapHouseholdKey(
      { wrappedKey: inv.wrappedHdk, iv: inv.iv, salt: inv.salt },
      inviteSecret
    );
  } catch {
    throw new Error('Code secret d’invitation incorrect.');
  }

  if (!inv.usedBy.includes(user.uid)) {
    const now = new Date().toISOString();
    const member: HouseholdMember = {
      uid: user.uid,
      displayName: userLabel(user),
      email: (user.email ?? '').slice(0, 320),
      role: 'member',
      joinedAt: now,
    };

    const batch = writeBatch(firestore);
    batch.update(inviteRef, {
      usedCount: increment(1),
      usedBy: arrayUnion(user.uid),
    });
    batch.update(doc(firestore, 'households', inv.householdId), {
      memberIds: arrayUnion(user.uid),
      [`members.${user.uid}`]: member,
      lastInviteId: cleanInviteId,
      updatedAt: now,
    });
    await batch.commit();
  }

  await saveCachedHouseholdKey(user.uid, inv.householdId, hdk);
  return { householdId: inv.householdId, householdName: inv.householdName, hdk };
}

export async function removeHouseholdMember(
  householdId: string,
  targetUid: string
): Promise<void> {
  const firestore = requireDb();
  await updateDoc(doc(firestore, 'households', householdId), {
    memberIds: arrayRemove(targetUid),
    [`members.${targetUid}`]: deleteField(),
    updatedAt: new Date().toISOString(),
  });
}

export async function leaveHousehold(householdId: string, uid: string): Promise<void> {
  await removeHouseholdMember(householdId, uid);
  removeCachedHouseholdKey(uid, householdId);
}

export async function deleteHousehold(householdId: string, uid: string): Promise<void> {
  const firestore = requireDb();
  await deleteDoc(doc(firestore, 'households', householdId));
  removeCachedHouseholdKey(uid, householdId);
}
