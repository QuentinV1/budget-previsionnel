import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, GoogleAuthProvider, getAuth } from 'firebase/auth';
import {
  Firestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCuYM0tMpd1f1jDYz27OhCaPpcAWhI3i48',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'quentin-apps-hub.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'quentin-apps-hub',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'quentin-apps-hub.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '249016348389',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:249016348389:web:4f5bdcbac0bec6fa9cee0c',
};

export function isFirebaseConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (isFirebaseConfigured()) {
  app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });
}

export { app, auth, db, googleProvider };
