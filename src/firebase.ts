import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  Firestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

export const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCuYM0tMpd1f1jDYz27OhCaPpcAWhI3i48',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'quentin-apps-hub.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'quentin-apps-hub',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'quentin-apps-hub.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '249016348389',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:249016348389:web:4f5bdcbac0bec6fa9cee0c',
};

export function isFirebaseConfigured(): boolean {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return false;
  }
  return Boolean(
    FIREBASE_CONFIG.apiKey &&
      FIREBASE_CONFIG.authDomain &&
      FIREBASE_CONFIG.projectId &&
      FIREBASE_CONFIG.appId
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (isFirebaseConfigured()) {
  try {
    app = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    auth = getAuth(app);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    });
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
  } catch (err) {
    console.warn('Firebase SDK indisponible (mode hors-ligne local):', err);
    app = null;
    auth = null;
    db = null;
    googleProvider = null;
  }
}

export function cleanForFirestore<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (v === undefined ? null : v))) as T;
}

export function formatSyncError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  const msg = (err as { message?: string })?.message || '';
  if (
    code === 'permission-denied' ||
    msg.includes('permission-denied') ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('PERMISSION_DENIED')
  ) {
    return 'Accès Firestore refusé (vérifiez que votre compte est bien autorisé).';
  }
  return msg || 'Erreur de synchronisation Firestore';
}

export async function connexionEmail(email: string, password: string): Promise<User> {
  if (!auth) throw new Error('Firebase indisponible hors-ligne.');
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function inscriptionEmail(
  email: string,
  password: string,
  displayName?: string
): Promise<User> {
  if (!auth) throw new Error('Firebase indisponible hors-ligne.');
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName && displayName.trim()) {
    await updateProfile(cred.user, { displayName: displayName.trim() }).catch(() => {});
  }
  await sendEmailVerification(cred.user).catch(() => {});
  return cred.user;
}

export async function connexionGoogle(): Promise<User> {
  if (!auth || !googleProvider) throw new Error('Firebase indisponible hors-ligne.');
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function renvoyerEmailVerification(): Promise<boolean> {
  if (!auth || !auth.currentUser) throw new Error('Aucun utilisateur connecté.');
  if (auth.currentUser.emailVerified) return false;
  await sendEmailVerification(auth.currentUser);
  return true;
}

export async function rechargerUtilisateurFirebase(): Promise<User | null> {
  if (!auth || !auth.currentUser) return null;
  await auth.currentUser.reload();
  return auth.currentUser;
}

export async function reinitialiserMotDePasse(email: string): Promise<void> {
  if (!auth) throw new Error('Firebase indisponible hors-ligne.');
  await sendPasswordResetEmail(auth, email.trim());
}

export async function deconnexionFirebase(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export { app, auth, db, googleProvider };
