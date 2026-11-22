import { FormEvent, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertCircle,
  Cloud,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Mail,
  PieChart,
  RefreshCw,
  Shield,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
import {
  connexionEmail,
  connexionGoogle,
  db,
  formatSyncError,
  inscriptionEmail,
  isFirebaseConfigured,
  reinitialiserMotDePasse,
} from '../firebase';
import { HouseholdDoc } from '../services/householdService';
import { resolveUserAccess, type AccessStatus } from '../services/accessControl';
import { AccessControlPanel } from './AccessControlPanel';

export interface CloudState {
  initialSyncDone: boolean;
  syncedCols: Record<string, boolean>;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  syncError: string | null;
  lastSyncedAt: string | null;
}

interface Props {
  open: boolean;
  blocking?: boolean;
  onClose: () => void;
  user: User | null;
  cloudState: CloudState;
  sheetsCount: number;
  linesCount: number;
  activeHousehold: HouseholdDoc | null;
  lockedHousehold: HouseholdDoc | null;
  pendingInvite?: boolean;
  onForceSync: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onOpenHouseholdModal: () => void;
  onOpenOnboardingModal: () => void;
}

function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'E-mail ou mot de passe incorrect.';
    case 'auth/email-already-in-use':
      return 'Un compte existe déjà avec cet e-mail.';
    case 'auth/weak-password':
      return 'Le mot de passe doit contenir au moins 6 caractères.';
    case 'auth/invalid-email':
      return 'Adresse e-mail invalide.';
    case 'auth/popup-closed-by-user':
      return 'Connexion Google annulée.';
    case 'auth/unauthorized-domain':
      return 'Domaine non autorisé dans Firebase Auth.';
    case 'auth/too-many-requests':
      return 'Trop de tentatives. Réessayez dans quelques minutes.';
    default:
      return formatSyncError(err);
  }
}

export function AuthGate({
  open,
  blocking = false,
  onClose,
  user,
  cloudState,
  sheetsCount,
  linesCount,
  activeHousehold,
  lockedHousehold,
  pendingInvite,
  onForceSync,
  onSignOut,
  onOpenHouseholdModal,
  onOpenOnboardingModal,
}: Props) {
  const configured = isFirebaseConfigured();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [syncLocalErr, setSyncLocalErr] = useState('');
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'account' | 'access'>('account');

  useEffect(() => {
    let cancelled = false;
    if (!open || !user || !db || !user.email) {
      setAccessStatus(null);
      setActiveTab('account');
      return;
    }
    resolveUserAccess(db, 'budget-previsionnel', user.email)
      .then((status) => {
        if (!cancelled) {
          setAccessStatus(status);
          if (!status.isAdmin) setActiveTab('account');
        }
      })
      .catch(() => {
        if (!cancelled) setAccessStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user?.uid, user?.email]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setInfo('');
    setSyncLocalErr('');
    if (blocking) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, blocking, onClose]);

  if (!open && !blocking) return null;

  const soumettreAuthEmail = async (isRegister: boolean, e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim() || !password) {
      setError('Veuillez renseigner votre e-mail et votre mot de passe.');
      return;
    }
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (isRegister) {
        await inscriptionEmail(email, password, name);
      } else {
        await connexionEmail(email, password);
      }
      if (!blocking) onClose();
    } catch (err: unknown) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const soumettreAuthGoogle = async () => {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await connexionGoogle();
      onClose();
    } catch (err: unknown) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setError('Entrez votre e-mail ci-dessus pour réinitialiser le mot de passe.');
      return;
    }
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await reinitialiserMotDePasse(email);
      setInfo('E-mail de réinitialisation envoyé (vérifiez vos spams).');
    } catch (err: unknown) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleForceSync = async () => {
    setSyncLocalErr('');
    setBusy(true);
    try {
      await onForceSync();
    } catch (err: unknown) {
      setSyncLocalErr(formatSyncError(err));
    } finally {
      setBusy(false);
    }
  };

  const renderSyncStatusText = () => {
    if (cloudState.syncStatus === 'syncing') {
      return { text: 'Synchronisation en cours…', cls: 'text-amber-600' };
    }
    if (cloudState.syncStatus === 'error') {
      return { text: 'Erreur de synchronisation', cls: 'text-rose-600' };
    }
    if (cloudState.initialSyncDone || cloudState.syncStatus === 'synced') {
      return {
        text: `Synchronisé (${sheetsCount} budget${sheetsCount > 1 ? 's' : ''}, ${linesCount} poste${linesCount > 1 ? 's' : ''})`,
        cls: 'text-emerald-700',
      };
    }
    return { text: 'Connexion au Cloud…', cls: 'text-slate-500' };
  };

  const statusInfo = renderSyncStatusText();
  const effectiveSyncError = syncLocalErr || cloudState.syncError || '';

  if (blocking && !user) {
    const highlights = [
      {
        icon: Users,
        title: 'Multi-profils & Compte commun',
        desc: 'Répartis revenus, charges et contributions au prorata du foyer.',
      },
      {
        icon: PieChart,
        title: 'Prévisionnel vs Réel',
        desc: 'Import bancaire CSV, graphiques et suivi des provisions mensuelles.',
      },
      {
        icon: ShieldCheck,
        title: 'Chiffrement de bout en bout',
        desc: 'Données budgétaires chiffrées (AES-256) avant sauvegarde Cloud.',
      },
    ];

    return (
      <div
        id="modal-auth"
        className="fixed inset-0 z-50 flex min-h-full items-center justify-center overflow-y-auto bg-gradient-to-br from-slate-100 via-emerald-50/40 to-slate-100 p-4 sm:p-6"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Compte Cloud Budget Prévisionnel"
          className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xl lg:grid-cols-12"
        >
          {/* Panneau éditorial */}
          <div className="relative flex flex-col justify-between bg-gradient-to-br from-slate-900 via-emerald-950 to-emerald-700 p-7 text-white lg:col-span-6 lg:p-10">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-xs">
                  <Wallet className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-xl font-extrabold tracking-tight">Budget Foyer</p>
                  <p className="text-xs text-emerald-100/80">Prévisionnel &amp; Suivi des dépenses</p>
                </div>
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
                  Pilote le budget du foyer en toute sérénité.
                </h1>
                <p className="text-sm text-emerald-100/80">
                  Synchronisé en temps réel entre tous les appareils du foyer et protégé par chiffrement AES-256.
                </p>
              </div>

              <div className="hidden space-y-3 pt-2 lg:block">
                {highlights.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.title}
                      className="flex items-start gap-3 rounded-2xl bg-white/10 p-3.5 ring-1 ring-white/10 backdrop-blur-xs"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
                        <Icon className="h-4 w-4 text-emerald-100" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <p className="text-xs text-emerald-100/80">{item.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 hidden items-center gap-2 text-xs text-emerald-100/70 lg:flex">
              <WifiOff className="h-3.5 w-3.5" />
              <span>Mode PWA hors-ligne inclus</span>
            </div>
          </div>

          {/* Formulaire */}
          <div id="auth-logged-out-panel" className="flex flex-col justify-center p-6 sm:p-8 lg:col-span-6 lg:p-10">
            <div className="mb-6 space-y-1">
              <h2 className="text-xl font-bold text-slate-900">
                {mode === 'login' ? 'Connexion à ton espace' : 'Créer ton compte'}
              </h2>
              <p className="text-sm text-slate-500">
                Utilise ton compte autorisé pour retrouver ton budget synchronisé.
              </p>
            </div>

            {!configured ? (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                <p className="font-semibold">Authentification indisponible</p>
                <p>Firebase Cloud n’est pas disponible dans cet environnement.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingInvite && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
                    <strong>Invitation détectée :</strong> connecte-toi ou crée un compte pour rejoindre ce foyer partagé.
                  </div>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={soumettreAuthGoogle}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
                >
                  <LogIn className="h-4 w-4" />
                  Continuer avec Google
                </button>

                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span>ou par e-mail</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <form
                  onSubmit={(e) => soumettreAuthEmail(mode === 'register', e)}
                  className="space-y-3"
                >
                  {mode === 'register' && (
                    <input
                      id="auth-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Prénom ou pseudo"
                      maxLength={40}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    />
                  )}
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="adresse@email.com"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  />
                  <div className="space-y-1.5">
                    <input
                      id="auth-password"
                      type="password"
                      required
                      minLength={6}
                      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mot de passe (6+ caractères)"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    />
                    {mode === 'login' && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleResetPassword}
                          className="text-[11px] font-medium text-emerald-700 hover:underline"
                        >
                          Mot de passe oublié ?
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-xs transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {mode === 'register' ? (
                      <>
                        <UserPlus className="h-4 w-4" />
                        Créer un compte
                      </>
                    ) : (
                      <>
                        <Mail className="h-4 w-4" />
                        Se connecter par e-mail
                      </>
                    )}
                  </button>
                </form>

                <button
                  type="button"
                  className="w-full cursor-pointer pt-1 text-center text-xs font-medium text-slate-500 hover:text-emerald-700"
                  onClick={() => {
                    setMode(mode === 'login' ? 'register' : 'login');
                    setError('');
                    setInfo('');
                  }}
                >
                  {mode === 'login'
                    ? 'Pas encore de compte ? Créer un compte'
                    : 'Déjà inscrit ? Se connecter'}
                </button>

                {error && (
                  <p
                    id="auth-error-msg"
                    className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-medium text-red-700"
                  >
                    {error}
                  </p>
                )}
                {info && (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs font-medium text-emerald-800">
                    {info}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      id="modal-auth"
      className={
        blocking
          ? 'fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 p-4'
          : 'fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4'
      }
      onMouseDown={(e) => !blocking && e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compte Cloud Budget Prévisionnel"
        className={`flex max-h-[90dvh] w-full flex-col bg-white shadow-xl sm:rounded-2xl sm:pb-0 ${
          blocking ? 'rounded-2xl' : 'rounded-t-2xl pb-[env(safe-area-inset-bottom)]'
        } ${
          user && accessStatus?.isAdmin && activeTab === 'access' ? 'sm:max-w-xl' : 'sm:max-w-md'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <Cloud className="h-5 w-5 text-indigo-600" />
            <span>Budget Prévisionnel — Connexion</span>
          </div>
          {!blocking && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {!configured ? (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <p className="font-semibold">Authentification indisponible</p>
              <p>
                Firebase Cloud n’est pas disponible dans cet environnement.
              </p>
            </div>
          ) : !user ? (
            /* Formulaire de connexion (affiché si déconnecté) */
            <div id="auth-logged-out-panel" className="space-y-3.5">
              <p className="text-xs text-slate-500">
                Connectez-vous ou créez un compte pour accéder à votre budget chiffré (AES-256) et synchronisé avec votre foyer.
              </p>

              {pendingInvite && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-xs text-indigo-900">
                  <strong>Invitation détectée :</strong> connectez-vous ou créez un compte pour rejoindre ce foyer partagé.
                </div>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={soumettreAuthGoogle}
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

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-[11px] font-medium text-slate-400">ou par e-mail</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <form onSubmit={(e) => soumettreAuthEmail(false, e)} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="auth-email">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                    <input
                      id="auth-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="prenom@exemple.fr"
                      className="w-full rounded-xl border border-slate-200 py-2 pr-3 pl-9 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700" htmlFor="auth-password">
                      Mot de passe (6 car. min)
                    </label>
                    <button
                      type="button"
                      onClick={handleResetPassword}
                      className="text-[11px] font-medium text-indigo-600 hover:underline"
                    >
                      Mot de passe oublié ?
                    </button>
                  </div>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                    <input
                      id="auth-password"
                      type="password"
                      required
                      minLength={6}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-slate-200 py-2 pr-3 pl-9 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="auth-name">
                    Prénom / pseudo (optionnel, pour création)
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex : Quentin"
                    maxLength={40}
                    className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>

                {error && (
                  <div
                    id="auth-error-msg"
                    className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {info && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
                    {info}
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    <LogIn className="h-4 w-4" />
                    Se connecter
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => soumettreAuthEmail(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <UserPlus className="h-4 w-4" />
                    Créer un compte
                  </button>
                </div>
              </form>

              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <p className="flex items-center gap-1 font-semibold">
                    <Lock className="h-3 w-3" /> Chiffrement de bout en bout (AES-256)
                  </p>
                  <p className="mt-0.5 text-[11px] text-emerald-800">
                    Vos données budgétaires sont chiffrées dans votre navigateur avant d’être sauvegardées sur le Cloud.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Panneau compte connecté */
            <div id="auth-logged-in-panel" className="space-y-3.5">
              {accessStatus?.isAdmin && (
                <div
                  role="tablist"
                  aria-label="Gestion du compte et des accès"
                  className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'account'}
                    onClick={() => setActiveTab('account')}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeTab === 'account'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Cloud className="h-3.5 w-3.5" />
                    <span>Compte Cloud</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'access'}
                    onClick={() => setActiveTab('access')}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeTab === 'access'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span>Accès &amp; Rôles</span>
                  </button>
                </div>
              )}

              {accessStatus?.isAdmin && activeTab === 'access' ? (
                <AccessControlPanel
                  db={db}
                  user={user}
                  appId="budget-previsionnel"
                  appName="Budget Prévisionnel"
                  theme="light"
                />
              ) : (
                <>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
                    <div className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                      Connecté en tant que
                    </div>
                    <div id="auth-connected-email" className="mt-0.5 text-sm font-bold break-all text-slate-900">
                      {user.email || user.displayName || user.uid}
                    </div>
                    <div id="auth-sync-status" className={`mt-1.5 text-xs font-medium ${statusInfo.cls}`}>
                      {statusInfo.text}
                    </div>
                  </div>

                  {accessStatus && !accessStatus.hasAppAccess && (
                    <div
                      id="auth-access-denied-msg"
                      className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800"
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Votre compte n&apos;est pas autorisé sur cette application. Contactez un administrateur.
                      </span>
                    </div>
                  )}

                  {effectiveSyncError && (
                    <div
                      id="auth-sync-error-msg"
                      className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{effectiveSyncError}</span>
                    </div>
                  )}

                  {lockedHousehold && (
                    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
                      <div className="flex items-center gap-1.5 font-bold text-amber-900">
                        <Lock className="h-3.5 w-3.5" />
                        <span>Foyer chiffré « {lockedHousehold.name} » verrouillé</span>
                      </div>
                      <p className="text-amber-800">
                        Saisissez votre phrase secrète ou clé de secours pour déchiffrer et synchroniser ce foyer sur cet appareil.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenOnboardingModal();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        Déverrouiller le foyer
                      </button>
                    </div>
                  )}

                  {activeHousehold && !lockedHousehold && (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-bold text-indigo-950 truncate">
                          Foyer : {activeHousehold.name}
                        </div>
                        <div className="text-[11px] text-indigo-700">
                          {activeHousehold.memberIds.length} membre{activeHousehold.memberIds.length > 1 ? 's' : ''} · Chiffré E2EE
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenHouseholdModal();
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-100"
                      >
                        <Users className="h-3.5 w-3.5 text-indigo-600" />
                        Partage & E2EE
                      </button>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      type="button"
                      id="btn-force-sync"
                      disabled={busy}
                      onClick={handleForceSync}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                      Synchroniser maintenant
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onSignOut}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                    >
                      <LogOut className="h-4 w-4" />
                      Se déconnecter
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
