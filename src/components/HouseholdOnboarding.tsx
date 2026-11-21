import { FormEvent, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  Plus,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { createDefaultState } from '../data/defaultData';
import { formatSyncError } from '../firebase';
import {
  HouseholdDoc,
  createHousehold,
  hasPassphraseVault,
  redeemHouseholdInvite,
  unlockFromPassphraseVault,
} from '../services/householdService';
import { importKeyBase64Url } from '../utils/crypto';
import { saveCachedHouseholdKey } from '../utils/keyCache';
import { hasLocalState, loadState } from '../utils/storage';
import { Modal } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  user: User;
  households: HouseholdDoc[];
  lockedHousehold: HouseholdDoc | null;
  initialInviteId?: string;
  initialInviteKey?: string;
  onUnlocked: (householdId: string, hdk: CryptoKey) => void;
}

export function HouseholdOnboarding({
  open,
  onClose,
  user,
  households,
  lockedHousehold,
  initialInviteId = '',
  initialInviteKey = '',
  onUnlocked,
}: Props) {
  const hasInvite = Boolean(initialInviteId && initialInviteKey);
  const [tab, setTab] = useState<'create' | 'join' | 'unlock'>(
    hasInvite ? 'join' : lockedHousehold ? 'unlock' : 'create'
  );

  // Create
  const [foyerName, setFoyerName] = useState('Mon Foyer');
  const [importLocal, setImportLocal] = useState(() => hasLocalState());
  const [passphrase, setPassphrase] = useState('');
  const [createdRecoveryKey, setCreatedRecoveryKey] = useState<{
    householdId: string;
    hdk: CryptoKey;
    recoveryKey: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Join
  const [inviteId, setInviteId] = useState(initialInviteId);
  const [inviteSecret, setInviteSecret] = useState(initialInviteKey);

  // Unlock
  const [unlockSecret, setUnlockSecret] = useState('');
  const [unlockMode, setUnlockMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [vaultAvailable, setVaultAvailable] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialInviteId && initialInviteKey) {
      setInviteId(initialInviteId);
      setInviteSecret(initialInviteKey);
      setTab('join');
    } else if (lockedHousehold) {
      setTab('unlock');
    } else {
      setTab('create');
    }
  }, [initialInviteId, initialInviteKey, lockedHousehold, open]);

  useEffect(() => {
    if (!lockedHousehold || !open) return;
    hasPassphraseVault(user.uid, lockedHousehold.id)
      .then((hasVault) => {
        setVaultAvailable(hasVault);
        setUnlockMode(hasVault ? 'passphrase' : 'recovery');
      })
      .catch(() => setVaultAvailable(false));
  }, [lockedHousehold, user.uid, open]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const initial = importLocal ? loadState() : createDefaultState();
      const res = await createHousehold(user, foyerName, initial, passphrase || undefined);
      setCreatedRecoveryKey(res);
    } catch (err: unknown) {
      setError(formatSyncError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await redeemHouseholdInvite(user, inviteId, inviteSecret);
      onUnlocked(res.householdId, res.hdk);
    } catch (err: unknown) {
      setError(formatSyncError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!lockedHousehold) return;
    setError('');
    setBusy(true);
    try {
      let hdk: CryptoKey;
      if (unlockMode === 'passphrase') {
        hdk = await unlockFromPassphraseVault(user.uid, lockedHousehold.id, unlockSecret);
      } else {
        hdk = await importKeyBase64Url(unlockSecret);
        await saveCachedHouseholdKey(user.uid, lockedHousehold.id, hdk);
      }
      onUnlocked(lockedHousehold.id, hdk);
    } catch {
      setError(
        unlockMode === 'passphrase'
          ? 'Phrase secrète incorrecte.'
          : 'Clé de secours invalide.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        createdRecoveryKey
          ? 'Foyer créé et chiffré (E2EE)'
          : lockedHousehold && tab === 'unlock'
            ? `Déverrouiller « ${lockedHousehold.name} »`
            : 'Foyer chiffré (Créer / Rejoindre)'
      }
    >
      {createdRecoveryKey ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-emerald-700">
            <CheckCircle2 className="h-7 w-7 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">Foyer créé et chiffré !</h2>
              <p className="text-xs text-slate-500">Conservez votre clé de secours en lieu sûr</p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
            <p className="font-semibold">Clé de secours du foyer (E2EE)</p>
            <p className="mt-1 text-[11px] text-amber-800">
              Vos données sont chiffrées de bout en bout. Si vous changez d’appareil sans phrase secrète, cette clé permet de déchiffrer votre foyer.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-amber-200 bg-white px-2.5 py-2 font-mono text-[11px] text-slate-900 select-all">
                {createdRecoveryKey.recoveryKey}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(createdRecoveryKey.recoveryKey);
                  setCopiedKey(true);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedKey ? 'Copiée' : 'Copier'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const target = createdRecoveryKey;
              setCreatedRecoveryKey(null);
              onUnlocked(target.householdId, target.hdk);
            }}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
          >
            Accéder à mon budget synchronisé
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {lockedHousehold && (
              <button
                type="button"
                onClick={() => {
                  setTab('unlock');
                  setError('');
                }}
                className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                  tab === 'unlock' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Déverrouiller
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setTab('create');
                setError('');
              }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                tab === 'create' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Créer un foyer
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('join');
                setError('');
              }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                tab === 'join' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Rejoindre
            </button>
          </div>

          {tab === 'unlock' && lockedHousehold && (
            <form onSubmit={handleUnlock} className="space-y-3">
              <div className="flex items-center gap-2 text-slate-900">
                <Lock className="h-4 w-4 text-amber-600" />
                <h2 className="text-sm font-bold">Déverrouiller « {lockedHousehold.name} »</h2>
              </div>
              <p className="text-xs text-slate-500">
                Ce navigateur ne possède pas encore la clé de chiffrement de ce foyer. Vous pouvez continuer à travailler en local ou saisir votre clé pour activer la synchronisation.
              </p>

              {vaultAvailable && (
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setUnlockMode('passphrase')}
                    className={`rounded-lg border px-2.5 py-1 font-medium ${
                      unlockMode === 'passphrase'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Phrase secrète
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnlockMode('recovery')}
                    className={`rounded-lg border px-2.5 py-1 font-medium ${
                      unlockMode === 'recovery'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Clé de secours
                  </button>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  {unlockMode === 'passphrase' ? 'Phrase secrète du coffre-fort' : 'Clé de secours du foyer'}
                </label>
                <input
                  type={unlockMode === 'passphrase' ? 'password' : 'text'}
                  required
                  value={unlockSecret}
                  onChange={(e) => setUnlockSecret(e.target.value)}
                  placeholder={unlockMode === 'passphrase' ? 'Votre phrase secrète' : 'Collez la clé de secours…'}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <KeyRound className="h-4 w-4" />
                {busy ? 'Déchiffrement…' : 'Déverrouiller le foyer'}
              </button>
            </form>
          )}

          {tab === 'create' && (
            <form onSubmit={handleCreate} className="space-y-3.5">
              <div className="flex items-center gap-2 text-slate-900">
                <Users className="h-4 w-4 text-indigo-600" />
                <h2 className="text-sm font-bold">
                  {households.length > 0 ? 'Créer un autre foyer' : 'Créer votre foyer chiffré'}
                </h2>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Nom du foyer</label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={foyerName}
                  onChange={(e) => setFoyerName(e.target.value)}
                  placeholder="Ex : Foyer Quentin & Marie"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Phrase secrète coffre-fort (optionnelle, min. 6 car.)
                </label>
                <input
                  type="password"
                  minLength={6}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Permet de déverrouiller sur un autre appareil"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </div>

              {hasLocalState() && (
                <label className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-xs text-indigo-950">
                  <input
                    type="checkbox"
                    checked={importLocal}
                    onChange={(e) => setImportLocal(e.target.checked)}
                    className="mt-0.5 rounded border-indigo-300"
                  />
                  <span>
                    <strong>Utiliser mon budget local actuel</strong> pour initialiser ce foyer chiffré.
                  </span>
                </label>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {busy ? 'Chiffrement et création…' : 'Créer le foyer sécurisé'}
              </button>
            </form>
          )}

          {tab === 'join' && (
            <form onSubmit={handleJoin} className="space-y-3.5">
              <div className="flex items-center gap-2 text-slate-900">
                <UserPlus className="h-4 w-4 text-emerald-600" />
                <h2 className="text-sm font-bold">Rejoindre un foyer partagé</h2>
              </div>
              <p className="text-xs text-slate-500">
                Collez l’identifiant d’invitation et le code secret transmis par un membre du foyer.
              </p>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Identifiant d’invitation</label>
                <input
                  type="text"
                  required
                  value={inviteId}
                  onChange={(e) => setInviteId(e.target.value)}
                  placeholder="inv_..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Code secret d’invitation</label>
                <input
                  type="text"
                  required
                  value={inviteSecret}
                  onChange={(e) => setInviteSecret(e.target.value)}
                  placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                {busy ? 'Vérification & déchiffrement…' : 'Rejoindre ce foyer'}
              </button>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
