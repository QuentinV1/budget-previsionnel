import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import {
  AlertCircle,
  Check,
  Cloud,
  FileSpreadsheet,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  Lock,
  PiggyBank,
  Plus,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Undo2,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { AuthGate, CloudState } from './components/AuthGate';
import { HouseholdModal } from './components/HouseholdModal';
import { HouseholdOnboarding } from './components/HouseholdOnboarding';
import { SavingsPage } from './components/SavingsPage';
import { SettingsModal } from './components/SettingsModal';
import { SheetPage } from './components/SheetPage';
import { SynthesisPage } from './components/SynthesisPage';
import { TipsPage } from './components/TipsPage';
import { TrackingPage } from './components/TrackingPage';
import {
  auth,
  deconnexionFirebase,
  formatSyncError,
  isFirebaseConfigured,
} from './firebase';
import {
  HouseholdDoc,
  createHousehold,
  decryptHouseholdState,
  mergeBudgetStates,
  saveHouseholdBudget,
  subscribeUserHouseholds,
  upsertUserProfile,
} from './services/householdService';
import { BudgetLine, BudgetState, SHEET_COLORS } from './types';
import { computeHousehold } from './utils/calc';
import {
  getActiveHouseholdId,
  loadCachedHouseholdKey,
  setActiveHouseholdId,
} from './utils/keyCache';
import { exportCsv, hasLocalState, loadState, saveState } from './utils/storage';
import { computeTips } from './utils/tips';

export const CURRENT_APP_VERSION = '1.1.0';
const LAST_UID_KEY = 'budget_foyer_last_uid';

const INITIAL_CLOUD_STATE: CloudState = {
  initialSyncDone: false,
  syncedCols: {},
  syncStatus: 'idle',
  syncError: null,
  lastSyncedAt: null,
};

function parseInviteFromHash(): { inviteId: string; inviteKey: string } {
  try {
    const hash = window.location.hash;
    if (!hash.includes('join')) return { inviteId: '', inviteKey: '' };
    const queryIdx = hash.indexOf('?');
    if (queryIdx === -1) return { inviteId: '', inviteKey: '' };
    const params = new URLSearchParams(hash.slice(queryIdx + 1));
    return {
      inviteId: params.get('invite') ?? '',
      inviteKey: params.get('key') ?? '',
    };
  } catch {
    return { inviteId: '', inviteKey: '' };
  }
}

export function App() {
  const firebaseEnabled = isFirebaseConfigured();

  // Local-first : on charge toujours l'état depuis localStorage au démarrage
  const [state, setState] = useState<BudgetState>(() => loadState());
  const stateRef = useRef<BudgetState>(state);
  stateRef.current = state;

  // Auth & Cloud Sync state (modèle app-charcuterie)
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const userRef = useRef<FirebaseUser | null>(null);
  userRef.current = user;

  const [cloudState, setCloudState] = useState<CloudState>(INITIAL_CLOUD_STATE);
  const cloudStateRef = useRef<CloudState>(cloudState);
  cloudStateRef.current = cloudState;

  const [households, setHouseholds] = useState<HouseholdDoc[]>([]);
  const [activeHousehold, setActiveHousehold] = useState<HouseholdDoc | null>(null);
  const activeHouseholdRef = useRef<HouseholdDoc | null>(null);
  activeHouseholdRef.current = activeHousehold;

  const [hdk, setHdk] = useState<CryptoKey | null>(null);
  const hdkRef = useRef<CryptoKey | null>(null);
  hdkRef.current = hdk;

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [householdModalOpen, setHouseholdModalOpen] = useState(false);

  const [pendingInvite, setPendingInvite] = useState(() => parseInviteFromHash());
  const pendingInviteRef = useRef(pendingInvite);
  pendingInviteRef.current = pendingInvite;

  const [activeTab, setActiveTab] = useState<string>('synthese');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [undoToast, setUndoToast] = useState<{ label: string; lines: BudgetLine[] } | null>(null);

  // Refs de contrôle de synchro (anti-écho & debounce 450 ms)
  const suppressCloudSyncRef = useRef(false);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRemoteCipherRef = useRef<string>('');
  const unsubHouseholdsRef = useRef<(() => void) | null>(null);

  const updateCloudState = useCallback((patch: Partial<CloudState>) => {
    setCloudState((prev) => {
      const next = { ...prev, ...patch };
      cloudStateRef.current = next;
      return next;
    });
  }, []);

  const reinitialiserEtatCloud = useCallback(() => {
    cloudStateRef.current = { ...INITIAL_CLOUD_STATE, syncedCols: {} };
    setCloudState(cloudStateRef.current);
  }, []);

  const arreterListenersFirestore = useCallback(() => {
    if (unsubHouseholdsRef.current) {
      try {
        unsubHouseholdsRef.current();
      } catch {
        /* ignore */
      }
      unsubHouseholdsRef.current = null;
    }
  }, []);

  // Push debounced (450 ms) vers Firestore après chaque sauvegarde locale
  const scheduleCloudSave = useCallback(
    (nextState: BudgetState) => {
      const currentUser = userRef.current;
      const household = activeHouseholdRef.current;
      const key = hdkRef.current;
      if (
        !currentUser ||
        !household ||
        !key ||
        !cloudStateRef.current.initialSyncDone ||
        suppressCloudSyncRef.current
      ) {
        return;
      }

      dirtyRef.current = true;
      updateCloudState({ syncStatus: 'syncing', syncError: null });
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      const householdId = household.id;
      const uid = currentUser.uid;
      saveTimerRef.current = setTimeout(async () => {
        try {
          const enc = await saveHouseholdBudget(householdId, uid, nextState, key);
          lastRemoteCipherRef.current = enc.ciphertext;
          dirtyRef.current = false;
          updateCloudState({
            syncStatus: 'synced',
            syncError: null,
            lastSyncedAt: new Date().toISOString(),
          });
        } catch (err: unknown) {
          dirtyRef.current = false;
          updateCloudState({
            syncStatus: 'error',
            syncError: formatSyncError(err),
          });
        }
      }, 450);
    },
    [updateCloudState]
  );

  // Applique le 1er snapshot serveur d'un foyer déchiffré (fusion nouvel appareil ou remplacement)
  const applyInitialServerHousehold = useCallback(
    async (
      currentUser: FirebaseUser,
      found: HouseholdDoc,
      key: CryptoKey,
      isNewDeviceLogin: boolean
    ) => {
      const serverState = await decryptHouseholdState(found, key);
      lastRemoteCipherRef.current = found.encryptedPayload?.ciphertext ?? '';

      const localItemsCount =
        (stateRef.current.sheets?.length || 0) + (stateRef.current.lines?.length || 0);
      let nextState = serverState;
      let needsPushAfterInit = false;

      if (localItemsCount > 0 && isNewDeviceLogin && hasLocalState()) {
        const { merged, hasLocalAdditions } = mergeBudgetStates(serverState, stateRef.current);
        nextState = merged;
        if (hasLocalAdditions) {
          needsPushAfterInit = true;
        }
      }

      suppressCloudSyncRef.current = true;
      setState(nextState);
      stateRef.current = nextState;
      saveState(nextState);
      suppressCloudSyncRef.current = false;

      updateCloudState({
        initialSyncDone: true,
        syncedCols: { ...cloudStateRef.current.syncedCols, households: true },
        syncStatus: 'synced',
        syncError: null,
        lastSyncedAt: new Date().toISOString(),
      });
      localStorage.setItem(LAST_UID_KEY, currentUser.uid);

      if (needsPushAfterInit) {
        const enc = await saveHouseholdBudget(found.id, currentUser.uid, nextState, key);
        lastRemoteCipherRef.current = enc.ciphertext;
      }
    },
    [updateCloudState]
  );

  // Démarre la synchronisation temps réel avec Firestore (modèle app-charcuterie)
  const activerSyncCloud = useCallback(
    async (currentUser?: FirebaseUser | null, preferredHouseholdId?: string) => {
      const targetUser = currentUser ?? userRef.current;
      arreterListenersFirestore();
      if (!firebaseEnabled || !targetUser) return;

      reinitialiserEtatCloud();
      updateCloudState({ syncStatus: 'syncing', syncError: null });

      if (!targetUser.emailVerified) {
        updateCloudState({
          syncStatus: 'error',
          syncError:
            'Accès Firestore refusé (vérifiez que votre e-mail est bien vérifié et autorisé).',
        });
        return;
      }

      upsertUserProfile(targetUser).catch(() => {});

      const currentUid = targetUser.uid;
      const previousUid = localStorage.getItem(LAST_UID_KEY);
      const isNewDeviceLogin = Boolean(currentUid && previousUid !== currentUid);

      unsubHouseholdsRef.current = subscribeUserHouseholds(
        currentUid,
        async (list, fromCache) => {
          // Ne jamais traiter un cache local vide comme un serveur vide
          if (fromCache && list.length === 0) {
            return;
          }

          setHouseholds(list);
          const isFirstServerForCol = !fromCache && !cloudStateRef.current.syncedCols.households;

          if (isFirstServerForCol) {
            updateCloudState({
              syncedCols: { ...cloudStateRef.current.syncedCols, households: true },
            });

            // Invitation en attente dans l'URL
            if (pendingInviteRef.current.inviteId && pendingInviteRef.current.inviteKey) {
              setShowOnboardingModal(true);
            }

            if (list.length === 0) {
              const localItemsCount =
                (stateRef.current.sheets?.length || 0) + (stateRef.current.lines?.length || 0);
              if (
                localItemsCount > 0 &&
                !(pendingInviteRef.current.inviteId && pendingInviteRef.current.inviteKey)
              ) {
                // Serveur vide + données locales présentes : créer automatiquement le foyer chiffré
                try {
                  const created = await createHousehold(
                    targetUser,
                    stateRef.current.householdName || 'Mon Foyer',
                    stateRef.current
                  );
                  setActiveHousehold(created.doc);
                  activeHouseholdRef.current = created.doc;
                  setHdk(created.hdk);
                  hdkRef.current = created.hdk;
                  setActiveHouseholdId(currentUid, created.householdId);
                  lastRemoteCipherRef.current = created.doc.encryptedPayload.ciphertext;
                  updateCloudState({
                    initialSyncDone: true,
                    syncStatus: 'synced',
                    syncError: null,
                    lastSyncedAt: new Date().toISOString(),
                  });
                  localStorage.setItem(LAST_UID_KEY, currentUid);
                } catch (err: unknown) {
                  updateCloudState({
                    syncStatus: 'error',
                    syncError: formatSyncError(err),
                  });
                }
              } else {
                updateCloudState({
                  initialSyncDone: true,
                  syncStatus: 'synced',
                  syncError: null,
                  lastSyncedAt: new Date().toISOString(),
                });
                localStorage.setItem(LAST_UID_KEY, currentUid);
              }
              return;
            }

            // Serveur non vide : sélectionner le foyer actif
            const targetId =
              preferredHouseholdId ?? getActiveHouseholdId(currentUid) ?? list[0].id;
            const found = list.find((h) => h.id === targetId) ?? list[0];
            setActiveHousehold(found);
            activeHouseholdRef.current = found;
            setActiveHouseholdId(currentUid, found.id);

            const cachedKey = await loadCachedHouseholdKey(currentUid, found.id);
            if (!cachedKey) {
              setHdk(null);
              hdkRef.current = null;
              updateCloudState({
                syncStatus: 'error',
                syncError: `Foyer chiffré « ${found.name} » verrouillé sur cet appareil. Déverrouillez-le avec votre phrase secrète ou clé de secours.`,
              });
              setShowOnboardingModal(true);
              return;
            }

            setHdk(cachedKey);
            hdkRef.current = cachedKey;

            try {
              await applyInitialServerHousehold(targetUser, found, cachedKey, isNewDeviceLogin);
            } catch {
              updateCloudState({
                syncStatus: 'error',
                syncError: 'Impossible de déchiffrer les données du foyer (clé invalide).',
              });
            }
          } else {
            // Snapshots suivants : remplacer le local sous _suppressCloudSync
            if (list.length === 0) return;
            const targetId =
              preferredHouseholdId ??
              activeHouseholdRef.current?.id ??
              getActiveHouseholdId(currentUid) ??
              list[0].id;
            const found = list.find((h) => h.id === targetId) ?? list[0];
            setActiveHousehold(found);
            activeHouseholdRef.current = found;

            let key = hdkRef.current;
            if (!key) {
              key = await loadCachedHouseholdKey(currentUid, found.id);
              if (key) {
                setHdk(key);
                hdkRef.current = key;
              }
            }
            if (!key) return;

            const cipher = found.encryptedPayload?.ciphertext ?? '';
            if (cipher && cipher !== lastRemoteCipherRef.current && !dirtyRef.current) {
              try {
                const decrypted = await decryptHouseholdState(found, key);
                lastRemoteCipherRef.current = cipher;
                suppressCloudSyncRef.current = true;
                setState(decrypted);
                stateRef.current = decrypted;
                saveState(decrypted);
                suppressCloudSyncRef.current = false;
                if (!fromCache) {
                  updateCloudState({
                    initialSyncDone: true,
                    syncStatus: 'synced',
                    syncError: null,
                    lastSyncedAt: new Date().toISOString(),
                  });
                }
              } catch {
                updateCloudState({
                  syncStatus: 'error',
                  syncError: 'Impossible de déchiffrer les données du foyer (clé invalide).',
                });
              }
            }
          }
        },
        (err) => {
          updateCloudState({
            syncStatus: 'error',
            syncError: formatSyncError(err),
          });
        }
      );
    },
    [
      applyInitialServerHousehold,
      arreterListenersFirestore,
      firebaseEnabled,
      reinitialiserEtatCloud,
      updateCloudState,
    ]
  );

  // Forcer un push complet (« Synchroniser maintenant »)
  const forcerSyncCloud = useCallback(async () => {
    const currentUser = userRef.current;
    if (!currentUser) throw new Error('Non connecté au Cloud.');
    if (!currentUser.emailVerified) {
      throw new Error(
        'Accès Firestore refusé (vérifiez que votre e-mail est bien vérifié et autorisé).'
      );
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    updateCloudState({ syncStatus: 'syncing', syncError: null });

    try {
      const household = activeHouseholdRef.current;
      const key = hdkRef.current;

      if (household && key) {
        const enc = await saveHouseholdBudget(household.id, currentUser.uid, stateRef.current, key);
        lastRemoteCipherRef.current = enc.ciphertext;
      } else if (!household) {
        const created = await createHousehold(
          currentUser,
          stateRef.current.householdName || 'Mon Foyer',
          stateRef.current
        );
        setActiveHousehold(created.doc);
        activeHouseholdRef.current = created.doc;
        setHdk(created.hdk);
        hdkRef.current = created.hdk;
        setActiveHouseholdId(currentUser.uid, created.householdId);
        lastRemoteCipherRef.current = created.doc.encryptedPayload.ciphertext;
      } else {
        setShowOnboardingModal(true);
        throw new Error(
          `Veuillez d’abord déverrouiller le foyer chiffré « ${household.name} » avec votre phrase secrète ou clé de secours.`
        );
      }

      dirtyRef.current = false;
      updateCloudState({
        initialSyncDone: true,
        syncStatus: 'synced',
        syncError: null,
        lastSyncedAt: new Date().toISOString(),
      });
      localStorage.setItem(LAST_UID_KEY, currentUser.uid);
    } catch (err: unknown) {
      const formatted = formatSyncError(err);
      updateCloudState({
        syncStatus: 'error',
        syncError: formatted,
      });
      throw new Error(formatted);
    }
  }, [updateCloudState]);

  // Écoute Firebase Auth (non bloquante)
  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      userRef.current = u;
      if (u) {
        await activerSyncCloud(u);
      } else {
        arreterListenersFirestore();
        reinitialiserEtatCloud();
        setHouseholds([]);
        setActiveHousehold(null);
        activeHouseholdRef.current = null;
        setHdk(null);
        hdkRef.current = null;
      }
    });
    return () => {
      unsub();
      arreterListenersFirestore();
    };
  }, [activerSyncCloud, arreterListenersFirestore, firebaseEnabled, reinitialiserEtatCloud]);

  // Si un lien d'invitation est présent dans l'URL au démarrage et que l'utilisateur n'est pas connecté, ouvrir la modale Cloud (non bloquante)
  useEffect(() => {
    if (pendingInvite.inviteId && pendingInvite.inviteKey && !user) {
      setAuthModalOpen(true);
    }
  }, [pendingInvite.inviteId, pendingInvite.inviteKey, user]);

  // Modification du budget : toujours écrit en local d'abord, puis push debounced (450 ms) si connecté
  const update = useCallback(
    (fn: (s: BudgetState) => BudgetState) => {
      setState((prev) => {
        const next = fn(prev);
        stateRef.current = next;
        saveState(next);
        if (!suppressCloudSyncRef.current) {
          scheduleCloudSave(next);
        }
        return next;
      });
    },
    [scheduleCloudSave]
  );

  // Déconnexion Cloud : désabonner listeners, réinitialiser cloudState, CONSERVER les données locales
  const handleSignOut = async () => {
    if (!window.confirm('Se déconnecter du compte Cloud ?')) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    arreterListenersFirestore();
    reinitialiserEtatCloud();
    lastRemoteCipherRef.current = '';
    dirtyRef.current = false;
    setHdk(null);
    hdkRef.current = null;
    setActiveHousehold(null);
    activeHouseholdRef.current = null;
    setHouseholds([]);
    setAuthModalOpen(false);
    setHouseholdModalOpen(false);
    setShowOnboardingModal(false);
    await deconnexionFirebase();
  };

  const handleUnlocked = async (householdId: string, unlockedKey: CryptoKey) => {
    const currentUser = userRef.current;
    if (!currentUser) return;
    if (pendingInvite.inviteId) {
      setPendingInvite({ inviteId: '', inviteKey: '' });
      if (window.location.hash.includes('join')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    setShowOnboardingModal(false);
    lastRemoteCipherRef.current = '';
    setHdk(unlockedKey);
    hdkRef.current = unlockedKey;
    setActiveHouseholdId(currentUser.uid, householdId);

    const found = households.find((h) => h.id === householdId);
    if (found) {
      setActiveHousehold(found);
      activeHouseholdRef.current = found;
      const previousUid = localStorage.getItem(LAST_UID_KEY);
      const isNewDeviceLogin = Boolean(currentUser.uid && previousUid !== currentUser.uid);
      try {
        await applyInitialServerHousehold(currentUser, found, unlockedKey, isNewDeviceLogin);
      } catch {
        await activerSyncCloud(currentUser, householdId);
      }
    } else {
      await activerSyncCloud(currentUser, householdId);
    }
  };

  const handleSwitchHousehold = async (householdId: string) => {
    const currentUser = userRef.current;
    if (!currentUser) return;
    lastRemoteCipherRef.current = '';
    dirtyRef.current = false;
    setActiveTab('synthese');
    setActiveHouseholdId(currentUser.uid, householdId);
    const target = households.find((h) => h.id === householdId) ?? null;
    setActiveHousehold(target);
    activeHouseholdRef.current = target;
    const cached = await loadCachedHouseholdKey(currentUser.uid, householdId);
    setHdk(cached);
    hdkRef.current = cached;
    if (target && cached) {
      try {
        const decrypted = await decryptHouseholdState(target, cached);
        lastRemoteCipherRef.current = target.encryptedPayload?.ciphertext ?? '';
        suppressCloudSyncRef.current = true;
        setState(decrypted);
        stateRef.current = decrypted;
        saveState(decrypted);
        suppressCloudSyncRef.current = false;
      } catch {
        updateCloudState({
          syncStatus: 'error',
          syncError: 'Impossible de déchiffrer ce foyer.',
        });
      }
    } else if (target && !cached) {
      setShowOnboardingModal(true);
    }
  };

  const summary = useMemo(() => computeHousehold(state), [state]);
  const tipsCount = useMemo(
    () =>
      computeTips(state, summary).filter(
        (t) => !state.dismissedTips.includes(t.id) && (t.level === 'alerte' || t.level === 'attention')
      ).length,
    [state, summary]
  );

  const removeLines = useCallback(
    (ids: string[], label: string) => {
      const removed = state.lines.filter((l) => ids.includes(l.id));
      if (!removed.length) return;
      update((s) => ({ ...s, lines: s.lines.filter((l) => !ids.includes(l.id)) }));
      setUndoToast({ label, lines: removed });
    },
    [state.lines, update]
  );

  const restoreLines = () => {
    if (!undoToast) return;
    const toRestore = undoToast.lines;
    update((s) => ({ ...s, lines: [...s.lines, ...toRestore] }));
    setUndoToast(null);
  };

  useEffect(() => {
    if (!undoToast) return;
    const t = setTimeout(() => setUndoToast(null), 6000);
    return () => clearTimeout(t);
  }, [undoToast]);

  const activeSheet = state.sheets.find((s) => s.id === activeTab) ?? null;
  const lockedHousehold = activeHousehold && !hdk ? activeHousehold : null;
  const userShortLabel = user
    ? (user.email || user.displayName || 'Cloud').split('@')[0]
    : 'Connexion';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header + Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sky-400 shadow-xs">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
                  Budget — {state.householdName}
                </h1>
                <span
                  id="header-version-badge"
                  className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
                >
                  v{CURRENT_APP_VERSION}
                </span>
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                {!user ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    <span>Sauvegarde locale</span>
                  </>
                ) : cloudState.syncStatus === 'syncing' ? (
                  <>
                    <RefreshCw className="h-3 w-3 animate-spin text-indigo-600" />
                    <span>Chiffrement & synchro…</span>
                  </>
                ) : cloudState.syncStatus === 'error' ? (
                  <>
                    <AlertCircle className="h-3 w-3 text-rose-600" />
                    <span className="max-w-[240px] truncate text-rose-700 sm:max-w-md">
                      {cloudState.syncError || 'Erreur synchro'}
                    </span>
                  </>
                ) : cloudState.initialSyncDone || cloudState.syncStatus === 'synced' ? (
                  <>
                    <Cloud className="h-3 w-3 text-emerald-600" />
                    <Lock className="h-2.5 w-2.5 text-emerald-600" />
                    <span>Chiffré & synchronisé</span>
                  </>
                ) : (
                  <>
                    <Cloud className="h-3 w-3 text-slate-400" />
                    <span>Connexion au Cloud…</span>
                  </>
                )}
                <span className="hidden sm:inline">· {state.sheets.length} budgets</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Bouton Connexion Cloud dans l'en-tête (aligné sur app-charcuterie) */}
            <button
              type="button"
              id="btn-auth-header"
              onClick={() => setAuthModalOpen(true)}
              title={user ? `Connecté : ${user.email || user.uid}` : 'Se connecter au Cloud'}
              aria-label="Compte Cloud"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                user
                  ? cloudState.syncStatus === 'error'
                    ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                    : 'border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {user ? (
                <User className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Cloud className="h-3.5 w-3.5 text-slate-600" />
              )}
              <span className="btn-text">{userShortLabel}</span>
            </button>

            {user && lockedHousehold && (
              <button
                type="button"
                onClick={() => setShowOnboardingModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
              >
                <KeyRound className="h-3.5 w-3.5 text-amber-700" />
                <span className="hidden sm:inline">Déverrouiller</span>
              </button>
            )}

            {user && activeHousehold && hdk && (
              <button
                type="button"
                onClick={() => setHouseholdModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1.5 text-xs font-medium text-indigo-900 transition hover:bg-indigo-100"
              >
                <Users className="h-3.5 w-3.5 text-indigo-600" />
                <span className="hidden sm:inline">Foyer</span>
                <span className="rounded-full bg-indigo-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {activeHousehold.memberIds.length}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => exportCsv(state)}
              className="hidden items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 sm:inline-flex"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Budgets & Données</span>
            </button>
          </div>
        </div>

        {/* Barre d'onglets : Feuilles Excel + Synthèse + Épargne + Suivi + Conseils */}
        <div className="border-t border-slate-100 bg-slate-50/60">
          <nav
            aria-label="Navigation principale"
            className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-1.5 sm:px-6"
          >
            <TabButton
              active={activeTab === 'synthese'}
              onClick={() => setActiveTab('synthese')}
              icon={<LayoutDashboard className="h-3.5 w-3.5" />}
              label="Synthèse"
            />

            <span className="mx-1 hidden h-4 w-px shrink-0 bg-slate-200 md:inline-block" aria-hidden="true" />

            {state.sheets.map((sh) => {
              const color = SHEET_COLORS[sh.color];
              const isActive = activeTab === sh.id;
              return (
                <button
                  key={sh.id}
                  type="button"
                  onClick={() => setActiveTab(sh.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition sm:px-3 sm:text-sm ${
                    isActive
                      ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200'
                      : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${color.bg}`} />
                  {sh.kind === 'common' ? (
                    <Users className="h-3.5 w-3.5 text-slate-400" />
                  ) : (
                    <User className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <span>
                    <span className="hidden md:inline">Budget - </span>
                    {sh.name}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Ajouter ou retirer un budget"
              aria-label="Ajouter ou retirer un budget"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <span className="mx-1 hidden h-4 w-px shrink-0 bg-slate-200 md:inline-block" aria-hidden="true" />

            <TabButton
              active={activeTab === 'epargne'}
              onClick={() => setActiveTab('epargne')}
              icon={<PiggyBank className="h-3.5 w-3.5" />}
              label="Épargne & Crédits"
            />
            <TabButton
              active={activeTab === 'suivi'}
              onClick={() => setActiveTab('suivi')}
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              label="Suivi & Simulation"
            />
            <TabButton
              active={activeTab === 'conseils'}
              onClick={() => setActiveTab('conseils')}
              icon={<Lightbulb className="h-3.5 w-3.5" />}
              label="Recommandations"
              badge={tipsCount > 0 ? tipsCount : undefined}
            />
          </nav>
        </div>
      </header>

      {/* Contenu */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {activeTab === 'synthese' && (
          <SynthesisPage state={state} summary={summary} update={update} goTo={setActiveTab} />
        )}
        {activeSheet && (
          <SheetPage
            state={state}
            sheet={activeSheet}
            summary={summary}
            update={update}
            removeLines={removeLines}
            goTo={setActiveTab}
          />
        )}
        {activeTab === 'epargne' && <SavingsPage state={state} summary={summary} update={update} />}
        {activeTab === 'suivi' && <TrackingPage state={state} summary={summary} update={update} />}
        {activeTab === 'conseils' && (
          <TipsPage state={state} summary={summary} update={update} goTo={setActiveTab} />
        )}
      </main>

      {/* Toast Annuler suppression */}
      {undoToast && (
        <div className="fixed right-4 bottom-4 z-40 flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-xs text-white shadow-lg">
          <span>« {undoToast.label} » supprimé</span>
          <button
            type="button"
            onClick={restoreLines}
            className="inline-flex items-center gap-1 font-semibold text-sky-400 hover:underline"
          >
            <Undo2 className="h-3.5 w-3.5" /> Annuler
          </button>
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        state={state}
        update={update}
        onSheetRemoved={(id) => {
          if (activeTab === id) setActiveTab('synthese');
        }}
      />

      {/* Modale Cloud non bloquante (alignée sur app-charcuterie) */}
      <AuthGate
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        user={user}
        cloudState={cloudState}
        sheetsCount={state.sheets.length}
        linesCount={state.lines.length}
        activeHousehold={activeHousehold}
        lockedHousehold={lockedHousehold}
        pendingInvite={Boolean(pendingInvite.inviteId && pendingInvite.inviteKey)}
        onForceSync={forcerSyncCloud}
        onEmailVerified={async () => {
          await activerSyncCloud(userRef.current);
        }}
        onSignOut={handleSignOut}
        onOpenHouseholdModal={() => setHouseholdModalOpen(true)}
        onOpenOnboardingModal={() => setShowOnboardingModal(true)}
      />

      {/* Modale Foyer & Partage E2EE */}
      {user && activeHousehold && hdk && (
        <HouseholdModal
          open={householdModalOpen}
          onClose={() => setHouseholdModalOpen(false)}
          user={user}
          household={activeHousehold}
          households={households}
          hdk={hdk}
          onSwitchHousehold={handleSwitchHousehold}
          onOpenCreateOrJoin={() => setShowOnboardingModal(true)}
          onLeftHousehold={() => activerSyncCloud(user)}
          onSignOut={handleSignOut}
        />
      )}

      {/* Modale Déverrouillage / Création / Invitation Foyer E2EE (non bloquante) */}
      {user && (
        <HouseholdOnboarding
          open={showOnboardingModal}
          onClose={() => setShowOnboardingModal(false)}
          user={user}
          households={households}
          lockedHousehold={lockedHousehold}
          initialInviteId={pendingInvite.inviteId}
          initialInviteKey={pendingInvite.inviteKey}
          onUnlocked={handleUnlocked}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
        active
          ? 'bg-slate-900 text-white shadow-xs'
          : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge != null && (
        <span className="rounded-full bg-amber-400 px-1.5 py-0.2 text-[10px] font-bold text-slate-950">
          {badge}
        </span>
      )}
    </button>
  );
}

export default App;
