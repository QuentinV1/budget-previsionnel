import { FormEvent, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Check,
  Copy,
  KeyRound,
  Link2,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  HouseholdDoc,
  InviteCreateResult,
  createHouseholdInvite,
  leaveHousehold,
  removeHouseholdMember,
  savePassphraseVault,
} from '../services/householdService';
import { exportKeyBase64Url } from '../utils/crypto';
import { Modal } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  user: User;
  household: HouseholdDoc;
  households: HouseholdDoc[];
  hdk: CryptoKey;
  onSwitchHousehold: (householdId: string) => void;
  onOpenCreateOrJoin: () => void;
  onLeftHousehold: () => void;
  onSignOut: () => void;
}

export function HouseholdModal({
  open,
  onClose,
  user,
  household,
  households,
  hdk,
  onSwitchHousehold,
  onOpenCreateOrJoin,
  onLeftHousehold,
  onSignOut,
}: Props) {
  const [invite, setInvite] = useState<InviteCreateResult | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [vaultSaved, setVaultSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isOwner = household.ownerId === user.uid;
  const membersList = Object.values(household.members ?? {});

  const handleGenerateInvite = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await createHouseholdInvite(household.id, household.name, user, hdk);
      setInvite(res);
      setCopiedLink(false);
      setCopiedSecret(false);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Erreur lors de la création de l’invitation.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevealRecovery = async () => {
    const k = await exportKeyBase64Url(hdk);
    setRecoveryKey(k);
    setCopiedRecovery(false);
  };

  const handleSavePassphrase = async (e: FormEvent) => {
    e.preventDefault();
    if (passphrase.trim().length < 6) {
      setError('La phrase secrète doit contenir au moins 6 caractères.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await savePassphraseVault(user.uid, household.id, hdk, passphrase);
      setPassphrase('');
      setVaultSaved(true);
      setTimeout(() => setVaultSaved(false), 4000);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Impossible d’enregistrer la phrase secrète.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (targetUid: string) => {
    setError('');
    setBusy(true);
    try {
      await removeHouseholdMember(household.id, targetUid);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Impossible de retirer ce membre.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    setError('');
    setBusy(true);
    try {
      await leaveHousehold(household.id, user.uid);
      onLeftHousehold();
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Impossible de quitter ce foyer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Foyer, Partage & Sécurité (E2EE)" wide>
      <div className="space-y-6">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</div>
        )}

        {/* Compte & Sélecteur de foyer */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900">
              Connecté : {user.displayName || user.email}
            </p>
            <p className="truncate text-[11px] text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-3.5 w-3.5" />
            Déconnexion sécurisée
          </button>
        </section>

        {/* Mes foyers */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-bold tracking-wider text-slate-500 uppercase">Mes foyers</h4>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCreateOrJoin();
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Créer ou rejoindre
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {households.map((h) => {
              const active = h.id === household.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    if (!active) {
                      onSwitchHousehold(h.id);
                      onClose();
                    }
                  }}
                  className={`flex items-center justify-between rounded-xl border p-3 text-left transition ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold">{h.name}</p>
                    <p className={`text-[11px] ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                      {h.memberIds.length} membre{h.memberIds.length > 1 ? 's' : ''}
                    </p>
                  </div>
                  {active && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
                </button>
              );
            })}
          </div>
        </section>

        {/* Partager le foyer */}
        <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                <UserPlus className="h-4 w-4 text-indigo-600" />
                Partager « {household.name} »
              </h4>
              <p className="mt-0.5 text-[11px] text-indigo-800">
                Générez un lien d’invitation chiffré (valable 7 jours, 5 utilisations max). La clé secrète reste dans le lien local et n’est jamais lue par le serveur.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleGenerateInvite}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5" />
              Générer une invitation
            </button>
          </div>

          {invite && (
            <div className="mt-3 space-y-2 rounded-xl border border-indigo-200 bg-white p-3 text-xs">
              <div>
                <p className="mb-1 text-[11px] font-semibold text-slate-600">Lien complet (à envoyer par message privé)</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={invite.shareUrl}
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(invite.shareUrl);
                      setCopiedLink(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedLink ? 'Copié' : 'Copier'}
                  </button>
                </div>
              </div>

              <div className="grid gap-2 pt-1 sm:grid-cols-2">
                <div>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">ID d’invitation</span>
                  <p className="font-mono text-[11px] text-slate-800 select-all">{invite.inviteId}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">Code secret</span>
                  <div className="flex items-center gap-1.5">
                    <p className="font-mono text-[11px] text-slate-800 select-all">{invite.inviteSecret}</p>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(invite.inviteSecret);
                        setCopiedSecret(true);
                      }}
                      className="text-[10px] font-semibold text-indigo-600 hover:underline"
                    >
                      {copiedSecret ? 'Copié' : 'Copier'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Membres du foyer */}
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">
            <Users className="h-3.5 w-3.5" />
            Membres du foyer ({membersList.length})
          </h4>
          <div className="space-y-2">
            {membersList.map((m) => (
              <div
                key={m.uid}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">
                    {m.displayName} {m.uid === user.uid && <span className="text-slate-400">(vous)</span>}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      m.role === 'owner'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {m.role === 'owner' ? 'Propriétaire' : 'Membre'}
                  </span>
                  {isOwner && m.uid !== user.uid && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRemoveMember(m.uid)}
                      title="Retirer ce membre"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {!isOwner && (
            <button
              type="button"
              disabled={busy}
              onClick={handleLeave}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
            >
              <UserMinus className="h-3.5 w-3.5" />
              Quitter ce foyer
            </button>
          )}
        </section>

        {/* Sécurité E2EE */}
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Chiffrement de bout en bout (AES-256-GCM)
              </h4>
              <p className="text-[11px] text-emerald-800">
                Protégez l’accès multi-appareils avec une phrase secrète ou sauvegardez votre clé de secours.
              </p>
            </div>
            {!recoveryKey && (
              <button
                type="button"
                onClick={handleRevealRecovery}
                className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-50"
              >
                Afficher la clé de secours
              </button>
            )}
          </div>

          {recoveryKey && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white p-2">
              <code className="flex-1 overflow-x-auto font-mono text-[11px] text-slate-900 select-all">
                {recoveryKey}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(recoveryKey);
                  setCopiedRecovery(true);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white"
              >
                <Copy className="h-3 w-3" />
                {copiedRecovery ? 'Copiée' : 'Copier'}
              </button>
            </div>
          )}

          <form onSubmit={handleSavePassphrase} className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <KeyRound className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="password"
                minLength={6}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Définir / changer ma phrase secrète coffre-fort…"
                className="w-full rounded-lg border border-emerald-200 bg-white py-1.5 pr-3 pl-8 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={busy || passphrase.trim().length < 6}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Enregistrer
            </button>
            {vaultSaved && <span className="text-[11px] font-semibold text-emerald-700">Enregistrée !</span>}
          </form>
        </section>
      </div>
    </Modal>
  );
}
