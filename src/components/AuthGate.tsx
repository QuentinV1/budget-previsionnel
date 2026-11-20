import { FormEvent, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { AlertCircle, KeyRound, Lock, LogIn, Mail, ShieldCheck, UserPlus, Wallet } from 'lucide-react';
import { auth, googleProvider, isFirebaseConfigured } from '../firebase';

interface Props {
  onUseLocalMode?: () => void;
  pendingInvite?: boolean;
}

function mapAuthError(code?: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email ou mot de passe incorrect.';
    case 'auth/email-already-in-use':
      return 'Un compte existe déjà avec cet email.';
    case 'auth/weak-password':
      return 'Le mot de passe doit contenir au moins 6 caractères.';
    case 'auth/invalid-email':
      return 'Adresse email invalide.';
    case 'auth/popup-closed-by-user':
      return 'Connexion Google annulée.';
    case 'auth/unauthorized-domain':
      return 'Domaine non autorisé dans Firebase Auth (ajoutez ce domaine dans Console Firebase → Authentication → Settings → Authorized domains).';
    case 'auth/too-many-requests':
      return 'Trop de tentatives. Réessayez dans quelques minutes.';
    default:
      return 'Erreur de connexion. Vérifiez vos identifiants et réessayez.';
  }
}

export function AuthGate({ onUseLocalMode, pendingInvite }: Props) {
  const configured = isFirebaseConfigured();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  if (!configured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sky-400">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Configuration Firebase requise</h1>
              <p className="text-xs text-slate-500">Base de données & authentification multi-utilisateurs</p>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            <p className="font-semibold">Les variables Firebase ne sont pas encore configurées.</p>
            <ol className="list-inside list-decimal space-y-1.5">
              <li>Créez un projet sur la Console Firebase (Auth Email + Google, et Cloud Firestore).</li>
              <li>Copiez <code className="rounded bg-amber-100 px-1">.env.example</code> vers <code className="rounded bg-amber-100 px-1">.env.local</code> avec vos clés <code className="rounded bg-amber-100 px-1">VITE_FIREBASE_*</code>.</li>
              <li>Déployez <code className="rounded bg-amber-100 px-1">firestore.rules</code> sur votre projet Firebase.</li>
            </ol>
          </div>

          {onUseLocalMode && (
            <button
              type="button"
              onClick={onUseLocalMode}
              className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Continuer en mode local (sans base de données)
            </button>
          )}
        </div>
      </div>
    );
  }

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) {
          await updateProfile(cred.user, { displayName: name.trim() });
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setError(mapAuthError(code));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (!auth || !googleProvider) return;
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setError(mapAuthError(code));
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!auth || !email.trim()) {
      setError('Entrez votre email ci-dessus pour réinitialiser le mot de passe.');
      return;
    }
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo('Email de réinitialisation envoyé (vérifiez vos spams).');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setError(mapAuthError(code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sky-400">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Budget Prévisionnel du Foyer</h1>
              <p className="text-xs text-slate-500">Connexion sécurisée & partage de foyer</p>
            </div>
          </div>

          {pendingInvite && (
            <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-xs text-indigo-900">
              <strong>Invitation détectée :</strong> connectez-vous ou créez un compte pour rejoindre ce foyer partagé.
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Créer un compte
            </button>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={handleGoogle}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            Continuer avec Google
          </button>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-medium text-slate-400">ou par email</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-3">
            {mode === 'register' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Prénom ou pseudo</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex : Quentin"
                  maxLength={40}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.fr"
                  className="w-full rounded-xl border border-slate-200 py-2 pr-3 pl-9 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700">Mot de passe</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    className="text-[11px] font-medium text-indigo-600 hover:underline"
                  >
                    Mot de passe oublié ?
                  </button>
                )}
              </div>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-200 py-2 pr-3 pl-9 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {info && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {mode === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {busy ? 'Connexion…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
            </button>
          </form>
        </div>

        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold flex items-center gap-1">
              <Lock className="h-3 w-3" /> Données financières chiffrées de bout en bout (AES-256)
            </p>
            <p className="mt-0.5 text-[11px] text-emerald-800">
              Vos revenus, dépenses, comptes et crédits sont chiffrés dans votre navigateur avant d’être enregistrés en base de données.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
