import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut } from 'firebase/auth';
import {
  AlertCircle,
  Check,
  Cloud,
  FileSpreadsheet,
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
import { AuthGate } from './components/AuthGate';
import { HouseholdModal } from './components/HouseholdModal';
import { HouseholdOnboarding } from './components/HouseholdOnboarding';
import { SavingsPage } from './components/SavingsPage';
import { SettingsModal } from './components/SettingsModal';
import { SheetPage } from './components/SheetPage';
import { SynthesisPage } from './components/SynthesisPage';
import { TipsPage } from './components/TipsPage';
import { TrackingPage } from './components/TrackingPage';
import { createDefaultState } from './data/defaultData';
import { auth, isFirebaseConfigured } from './firebase';
import {
  HouseholdDoc,
  decryptHouseholdState,
  listUserHouseholds,
  saveHouseholdBudget,
  subscribeHousehold,
  upsertUserProfile,
} from './services/householdService';
import { BudgetLine, BudgetState, SHEET_COLORS } from './types';
import { computeHousehold } from './utils/calc';
import {
  clearAllCachedKeys,
  getActiveHouseholdId,
  loadCachedHouseholdKey,
  setActiveHouseholdId,
} from './utils/keyCache';
import { clearLocalState, exportCsv, loadState, saveState } from './utils/storage';
import { computeTips } from './utils/tips';

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
  const [localMode, setLocalMode] = useState(false);

  // Auth & Foyer state
  const [authReady, setAuthReady] = useState(!firebaseEnabled);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [households, setHouseholds] = useState<HouseholdDoc[]>([]);
  const [activeHousehold, setActiveHousehold] = useState<HouseholdDoc | null>(null);
  const [hdk, setHdk] = useState<CryptoKey | null>(null);
  const [householdsLoaded, setHouseholdsLoaded] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [householdModalOpen, setHouseholdModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'saving' | 'error'>('synced');
  const [syncError, setSyncError] = useState('');

  const [pendingInvite, setPendingInvite] = useState(() => parseInviteFromHash());

  // Budget state
  const [state, setState] = useState<BudgetState>(() =>
    firebaseEnabled ? createDefaultState() : loadState()
  );
  const [activeTab, setActiveTab] = useState<string>('synthese');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [undoToast, setUndoToast] = useState<{ label: string; lines: BudgetLine[] } | null>(null);

  // Refs pour éviter la boucle d'écho entre sauvegarde locale et onSnapshot
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRemoteCipherRef = useRef<string>('');

  // Écoute Firebase Auth
  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        upsertUserProfile(u).catch(() => {});
      } else {
        setHouseholds([]);
        setActiveHousehold(null);
        setHdk(null);
        setHouseholdsLoaded(false);
        setState(createDefaultState());
      }
    });
    return unsub;
  }, [firebaseEnabled]);

  // Charge les foyers de l'utilisateur connecté
  const refreshHouseholds = useCallback(
    async (uid: string, preferredId?: string) => {
      setHouseholdsLoaded(false);
      try {
        const list = await listUserHouseholds(uid);
        setHouseholds(list);
        const targetId = preferredId ?? getActiveHouseholdId(uid) ?? list[0]?.id ?? null;
        const found = list.find((h) => h.id === targetId) ?? list[0] ?? null;
        setActiveHousehold(found);
        if (found) {
          setActiveHouseholdId(uid, found.id);
          const cached = await loadCachedHouseholdKey(uid, found.id);
          setHdk(cached);
        } else {
          setHdk(null);
        }
      } catch (err: unknown) {
        setSyncError((err as Error)?.message || 'Erreur lors du chargement des foyers.');
        setSyncStatus('error');
      } finally {
        setHouseholdsLoaded(true);
      }
    },
    []
  );

  useEffect(() => {
    if (user && !localMode) {
      refreshHouseholds(user.uid);
    }
  }, [user, localMode, refreshHouseholds]);

  // Abonnement temps réel au foyer actif + déchiffrement E2EE
  useEffect(() => {
    if (!user || !activeHousehold?.id || !hdk || localMode) return;
    const householdId = activeHousehold.id;

    const unsub = subscribeHousehold(
      householdId,
      async (docData) => {
        if (!docData) {
          refreshHouseholds(user.uid);
          return;
        }
        setActiveHousehold(docData);
        setHouseholds((prev) => prev.map((h) => (h.id === docData.id ? docData : h)));

        const cipher = docData.encryptedPayload?.ciphertext ?? '';
        if (cipher && cipher !== lastRemoteCipherRef.current && !dirtyRef.current) {
          try {
            const decrypted = await decryptHouseholdState(docData, hdk);
            lastRemoteCipherRef.current = cipher;
            setState(decrypted);
            setSyncStatus('synced');
            setSyncError('');
          } catch {
            setSyncStatus('error');
            setSyncError('Impossible de déchiffrer les données du foyer (clé invalide).');
          }
        }
      },
      (err) => {
        setSyncStatus('error');
        setSyncError(err.message);
      }
    );

    return unsub;
  }, [user, activeHousehold?.id, hdk, localMode, refreshHouseholds]);

  // Sauvegarde locale uniquement en mode local (sans Firebase)
  useEffect(() => {
    if (localMode || !firebaseEnabled) {
      saveState(state);
    }
  }, [state, localMode, firebaseEnabled]);

  // Sauvegarde chiffrée debounced vers Firestore
  const scheduleCloudSave = useCallback(
    (nextState: BudgetState) => {
      if (!user || !activeHousehold || !hdk || localMode) return;
      dirtyRef.current = true;
      setSyncStatus('saving');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      const householdId = activeHousehold.id;
      const uid = user.uid;
      saveTimerRef.current = setTimeout(async () => {
        try {
          await saveHouseholdBudget(householdId, uid, nextState, hdk);
          dirtyRef.current = false;
          setSyncStatus('synced');
          setSyncError('');
        } catch (err: unknown) {
          dirtyRef.current = false;
          setSyncStatus('error');
          setSyncError((err as Error)?.message || 'Erreur de synchronisation.');
        }
      }, 450);
    },
    [user, activeHousehold, hdk, localMode]
  );

  const update = useCallback(
    (fn: (s: BudgetState) => BudgetState) => {
      setState((prev) => {
        const next = fn(prev);
        if (firebaseEnabled && !localMode && user && activeHousehold && hdk) {
          scheduleCloudSave(next);
        }
        return next;
      });
    },
    [firebaseEnabled, localMode, user, activeHousehold, hdk, scheduleCloudSave]
  );

  const handleSignOut = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (user) clearAllCachedKeys(user.uid);
    clearLocalState();
    lastRemoteCipherRef.current = '';
    dirtyRef.current = false;
    setState(createDefaultState());
    setHdk(null);
    setActiveHousehold(null);
    setActiveTab('synthese');
    if (auth) await signOut(auth);
  };

  const handleUnlocked = async (householdId: string, unlockedKey: CryptoKey) => {
    if (!user) return;
    if (pendingInvite.inviteId) {
      setPendingInvite({ inviteId: '', inviteKey: '' });
      if (window.location.hash.includes('join')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    setShowOnboardingModal(false);
    lastRemoteCipherRef.current = '';
    setHdk(unlockedKey);
    await refreshHouseholds(user.uid, householdId);
  };

  const handleSwitchHousehold = async (householdId: string) => {
    if (!user) return;
    lastRemoteCipherRef.current = '';
    dirtyRef.current = false;
    setActiveTab('synthese');
    setActiveHouseholdId(user.uid, householdId);
    const target = households.find((h) => h.id === householdId) ?? null;
    setActiveHousehold(target);
    const cached = await loadCachedHouseholdKey(user.uid, householdId);
    setHdk(cached);
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

  // Gates d'authentification et de foyer
  if (firebaseEnabled && !localMode) {
    if (!authReady) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-xs text-slate-500">
          Chargement sécurisé…
        </div>
      );
    }

    if (!user) {
      return (
        <AuthGate
          onUseLocalMode={!firebaseEnabled ? () => setLocalMode(true) : undefined}
          pendingInvite={Boolean(pendingInvite.inviteId && pendingInvite.inviteKey)}
        />
      );
    }

    if (!householdsLoaded) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-xs text-slate-500">
          Chargement de vos foyers…
        </div>
      );
    }

    if (
      showOnboardingModal ||
      !activeHousehold ||
      !hdk ||
      (pendingInvite.inviteId && pendingInvite.inviteKey)
    ) {
      return (
        <HouseholdOnboarding
          user={user}
          households={households}
          lockedHousehold={!showOnboardingModal && activeHousehold && !hdk ? activeHousehold : null}
          initialInviteId={pendingInvite.inviteId}
          initialInviteKey={pendingInvite.inviteKey}
          onUnlocked={handleUnlocked}
          onSignOut={handleSignOut}
        />
      );
    }
  } else if (!firebaseEnabled && !localMode) {
    return <AuthGate onUseLocalMode={() => setLocalMode(true)} />;
  }

  const activeSheet = state.sheets.find((s) => s.id === activeTab) ?? null;

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
              <h1 className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
                Budget — {state.householdName}
              </h1>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                {localMode ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    <span>Sauvegarde locale</span>
                  </>
                ) : syncStatus === 'saving' ? (
                  <>
                    <RefreshCw className="h-3 w-3 animate-spin text-indigo-600" />
                    <span>Chiffrement & synchro…</span>
                  </>
                ) : syncStatus === 'error' ? (
                  <>
                    <AlertCircle className="h-3 w-3 text-rose-600" />
                    <span className="text-rose-700">{syncError || 'Erreur synchro'}</span>
                  </>
                ) : (
                  <>
                    <Cloud className="h-3 w-3 text-emerald-600" />
                    <Lock className="h-2.5 w-2.5 text-emerald-600" />
                    <span>Chiffré & synchronisé</span>
                  </>
                )}
                <span className="hidden sm:inline">· {state.sheets.length} budgets</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!localMode && activeHousehold && (
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
                  {sh.kind === 'common' ? <Users className="h-3.5 w-3.5 text-slate-400" /> : <User className="h-3.5 w-3.5 text-slate-400" />}
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

      {!localMode && user && activeHousehold && hdk && (
        <HouseholdModal
          open={householdModalOpen}
          onClose={() => setHouseholdModalOpen(false)}
          user={user}
          household={activeHousehold}
          households={households}
          hdk={hdk}
          onSwitchHousehold={handleSwitchHousehold}
          onOpenCreateOrJoin={() => setShowOnboardingModal(true)}
          onLeftHousehold={() => refreshHouseholds(user.uid)}
          onSignOut={handleSignOut}
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
