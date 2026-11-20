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
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
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
  return user.displayName?.trim() || user.email?.split('@')[0] || 'Membre';
}

export async function upsertUserProfile(user: User): Promise<void> {
  const firestore = requireDb();
  await setDoc(
    doc(firestore, 'users', user.uid),
    {
      displayName: userLabel(user),
      email: user.email ?? '',
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
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

export function subscribeHousehold(
  householdId: string,
  onData: (docData: HouseholdDoc | null) => void,
  onError: (err: Error) => void
): () => void {
  const firestore = requireDb();
  return onSnapshot(
    doc(firestore, 'households', householdId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData({ id: snap.id, ...(snap.data() as Omit<HouseholdDoc, 'id'>) });
    },
    (err) => onError(err)
  );
}

export async function createHousehold(
  user: User,
  name: string,
  initialState: BudgetState,
  passphrase?: string
): Promise<{ householdId: string; hdk: CryptoKey; recoveryKey: string }> {
  const firestore = requireDb();
  const householdId = generateRandomId('foyer');
  const hdk = await generateHouseholdKey();
  const cleanName = name.trim().slice(0, 80) || 'Mon Foyer';
  const now = new Date().toISOString();

  const stateToEncrypt: BudgetState = {
    ...initialState,
    householdName: cleanName,
    updatedAt: now,
  };
  const encryptedPayload = await encryptPayload(stateToEncrypt, hdk);

  const member: HouseholdMember = {
    uid: user.uid,
    displayName: userLabel(user),
    email: user.email ?? '',
    role: 'owner',
    joinedAt: now,
  };

  await setDoc(doc(firestore, 'households', householdId), {
    name: cleanName,
    ownerId: user.uid,
    memberIds: [user.uid],
    members: { [user.uid]: member },
    encryptedPayload,
    createdAt: now,
    updatedAt: now,
  });

  await saveCachedHouseholdKey(user.uid, householdId, hdk);
  if (passphrase && passphrase.trim().length >= 6) {
    await savePassphraseVault(user.uid, householdId, hdk, passphrase);
  }

  const recoveryKey = await exportKeyBase64Url(hdk);
  return { householdId, hdk, recoveryKey };
}

export async function saveHouseholdBudget(
  householdId: string,
  uid: string,
  state: BudgetState,
  hdk: CryptoKey
): Promise<void> {
  const firestore = requireDb();
  const now = new Date().toISOString();
  const encryptedPayload = await encryptPayload({ ...state, updatedAt: now }, hdk);
  await updateDoc(doc(firestore, 'households', householdId), {
    name: state.householdName.trim().slice(0, 80) || 'Mon Foyer',
    encryptedPayload: { ...encryptedPayload, updatedAt: now, updatedBy: uid },
    updatedAt: now,
  });
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
  await setDoc(doc(firestore, 'users', uid, 'keyVault', householdId), {
    ...wrapped,
    mode: 'passphrase',
    updatedAt: new Date().toISOString(),
  });
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
    householdName,
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
      email: user.email ?? '',
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
