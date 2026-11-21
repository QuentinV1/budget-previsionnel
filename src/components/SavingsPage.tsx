import { useMemo, useState } from 'react';
import { Calendar, Landmark, PiggyBank, Plus, ShieldCheck, Target, Trash2, TrendingUp } from 'lucide-react';
import { AccountType, BudgetState, Loan, SavingsAccount, SavingsGoal } from '../types';
import { HouseholdSummary } from '../utils/calc';
import {
  accountBalance,
  accountContribution,
  accountLastDate,
  computeLoan,
  computeReserve,
  computeScenarios,
  expectedBalanceNow,
  project,
  sortedHistory,
} from '../utils/finance';
import { createId, formatDate, formatEuro, formatPct, todayIso } from '../utils/format';
import { LineChart, Sparkline } from './charts';
import { Button, Card, EmptyState, Field, Kpi, Modal, MoneyInput, ProgressBar, inputCls } from './ui';
import { Updater } from './SheetPage';

interface Props {
  state: BudgetState;
  summary: HouseholdSummary;
  update: Updater;
}

export function SavingsPage({ state, summary, update }: Props) {
  const [snapAccId, setSnapAccId] = useState<string | null>(null);
  const [snapDate, setSnapDate] = useState(todayIso());
  const [snapBalance, setSnapBalance] = useState(0);

  const [newAccOpen, setNewAccOpen] = useState(false);
  const [accOwner, setAccOwner] = useState(state.sheets[0]?.id ?? '');
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('livret');
  const [accInit, setAccInit] = useState(0);
  const [accCap, setAccCap] = useState(true);

  const [goalOpen, setGoalOpen] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState(2000);
  const [goalDeadline, setGoalDeadline] = useState('');

  const [loanOpen, setLoanOpen] = useState(false);
  const [loanForm, setLoanForm] = useState<Partial<Loan>>({
    name: '',
    ownerId: state.sheets[0]?.id ?? '',
    initial: null,
    remaining: 0,
    rate: null,
    endDate: '',
    linkedLineId: '',
    note: '',
  });

  const [showConstantEuros, setShowConstantEuros] = useState(false);

  const reserve = useMemo(() => computeReserve(state, summary), [state, summary]);
  const scenarios = useMemo(() => computeScenarios(state, summary), [state, summary]);

  const totalLivrets = useMemo(
    () => state.accounts.filter((a) => a.type === 'livret').reduce((s, a) => s + accountBalance(a), 0),
    [state.accounts]
  );
  const totalPlacements = useMemo(
    () => state.accounts.filter((a) => a.type === 'placement').reduce((s, a) => s + accountBalance(a), 0),
    [state.accounts]
  );
  const totalWealth = totalLivrets + totalPlacements;
  const totalDebtRemaining = useMemo(
    () => state.loans.reduce((s, l) => s + computeLoan(l, summary.monthly).remainingNow, 0),
    [state.loans, summary.monthly]
  );

  // Projections 30 ans
  const years = Math.max(5, Math.min(50, state.assumptions.horizonYears || 30));
  const xLabels = useMemo(() => Array.from({ length: years + 1 }, (_, i) => (i === 0 ? 'Auj.' : `${i} a`)), [years]);

  const projSeries = useMemo(() => {
    const inf = state.assumptions.inflation / 100;
    const deflate = (v: number, y: number) => (showConstantEuros ? v / Math.pow(1 + inf, y) : v);
    return scenarios.map((sc) => {
      const pts = project(state, reserve, sc.monthly, state.assumptions.rateCentral, years);
      return {
        id: sc.id,
        label: `${sc.label} (${formatEuro(sc.monthly, false)}/m)`,
        color: sc.color,
        values: pts.map((p) => deflate(p.invested, p.year)),
      };
    });
  }, [scenarios, state, reserve, years, showConstantEuros]);

  const openSnapshot = (acc: SavingsAccount) => {
    setSnapAccId(acc.id);
    setSnapDate(todayIso());
    setSnapBalance(accountBalance(acc));
  };

  const saveSnapshot = () => {
    if (!snapAccId) return;
    update((s) => ({
      ...s,
      accounts: s.accounts.map((a) => {
        if (a.id !== snapAccId) return a;
        const filtered = a.history.filter((h) => h.date !== snapDate);
        return { ...a, history: [...filtered, { date: snapDate, balance: snapBalance }] };
      }),
    }));
    setSnapAccId(null);
  };

  const addAccount = () => {
    if (!accName.trim()) return;
    const acc: SavingsAccount = {
      id: createId('acc'),
      ownerId: accOwner || state.sheets[0]?.id || '',
      name: accName.trim(),
      type: accType,
      capitalise: accType === 'placement' ? accCap : false,
      monthlyIncome: 0,
      note: '',
      linkedLineIds: [],
      history: [{ date: todayIso(), balance: accInit }],
    };
    update((s) => ({ ...s, accounts: [...s.accounts, acc] }));
    setAccName('');
    setAccInit(0);
    setNewAccOpen(false);
  };

  const addGoal = () => {
    if (!goalName.trim() || goalTarget <= 0) return;
    const g: SavingsGoal = {
      id: createId('goal'),
      name: goalName.trim(),
      target: goalTarget,
      deadline: goalDeadline,
      accountIds: [],
      color: '#6366f1',
    };
    update((s) => ({ ...s, goals: [...s.goals, g] }));
    setGoalName('');
    setGoalOpen(false);
  };

  const addLoan = () => {
    if (!loanForm.name?.trim()) return;
    const loan: Loan = {
      id: createId('loan'),
      name: loanForm.name.trim(),
      ownerId: loanForm.ownerId || state.sheets[0]?.id || '',
      initial: loanForm.initial ?? null,
      remaining: loanForm.remaining ?? 0,
      rate: loanForm.rate ?? null,
      endDate: loanForm.endDate ?? '',
      linkedLineId: loanForm.linkedLineId ?? '',
      note: loanForm.note ?? '',
      asOf: todayIso(),
    };
    update((s) => ({ ...s, loans: [...s.loans, loan] }));
    setLoanOpen(false);
  };

  const savingsLines = state.lines.filter((l) => l.section === 'expense' && l.categoryId === 'epargne');
  const debtLines = state.lines.filter((l) => l.section !== 'resource' && l.group !== 'virements');

  return (
    <div className="space-y-6">
      {/* KPIs Patrimoine */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Patrimoine financier"
          value={formatEuro(totalWealth, false)}
          hint={`${formatEuro(totalLivrets, false)} livrets · ${formatEuro(totalPlacements, false)} placements`}
          icon={<Landmark className="h-4 w-4 text-indigo-600" />}
        />
        <Kpi
          label="Épargne mensuelle"
          value={formatEuro(summary.savings)}
          hint={`${formatPct(summary.savingsRate)} des revenus externes`}
          tone="accent"
          icon={<PiggyBank className="h-4 w-4 text-indigo-600" />}
        />
        <Kpi
          label="Réserve de sécurité"
          value={`${reserve.monthsCovered.toFixed(1)} mois`}
          hint={
            reserve.gap > 0
              ? `Écart : ${formatEuro(reserve.gap, false)} (cible ${state.assumptions.reserveMonths} mois)`
              : `Cible de ${state.assumptions.reserveMonths} mois couverte`
          }
          tone={reserve.gap > 0 ? 'default' : 'good'}
          icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />}
        />
        <Kpi
          label="Dettes restantes"
          value={formatEuro(totalDebtRemaining, false)}
          hint={`${formatEuro(summary.credits)} / mois de mensualités`}
          icon={<Calendar className="h-4 w-4 text-slate-500" />}
        />
      </div>

      {/* Comptes d'épargne & relevés */}
      <Card
        title="Comptes d'épargne & placements"
        subtitle="Suivez vos encours réels par personne. Cliquez sur « Relevé » pour enregistrer le solde du jour."
        action={
          <Button variant="primary" onClick={() => setNewAccOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Nouveau compte
          </Button>
        }
      >
        {state.accounts.length === 0 ? (
          <EmptyState>Aucun compte d’épargne enregistré.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {state.accounts.map((acc) => {
              const owner = state.sheets.find((s) => s.id === acc.ownerId);
              const bal = accountBalance(acc);
              const expected = expectedBalanceNow(acc, summary.monthly);
              const contrib = accountContribution(acc, summary.monthly);
              const hist = sortedHistory(acc);
              const lastDate = accountLastDate(acc);
              return (
                <div key={acc.id} className="flex flex-col justify-between rounded-xl border border-slate-200 p-4">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 uppercase">
                          {owner?.name ?? '?'} · {acc.type === 'livret' ? 'Livret' : 'Placement'}
                        </span>
                        <h3 className="mt-1 font-semibold text-slate-900">{acc.name}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          update((s) => ({ ...s, accounts: s.accounts.filter((x) => x.id !== acc.id) }))
                        }
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label={`Supprimer ${acc.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div>
                        <p className="text-2xl font-bold text-slate-900 tabular-nums">{formatEuro(bal, false)}</p>
                        <p className="text-[11px] text-slate-400">Relevé du {formatDate(lastDate)}</p>
                      </div>
                      <Sparkline values={hist.map((h) => h.balance)} />
                    </div>

                    {contrib > 0 && (
                      <p className="mt-2 rounded-lg bg-indigo-50/70 px-2.5 py-1 text-xs text-indigo-800 tabular-nums">
                        Alimenté à <strong>{formatEuro(contrib)}</strong> / mois · attendu auj. :{' '}
                        {formatEuro(expected, false)}
                      </p>
                    )}
                    {acc.monthlyIncome > 0 && (
                      <p className="mt-1.5 text-xs text-emerald-700">
                        Revenu déclaré : {formatEuro(acc.monthlyIncome)} / mois
                      </p>
                    )}
                    {acc.note && <p className="mt-2 text-[11px] text-slate-500">{acc.note}</p>}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                    <select
                      aria-label={`Lier une ligne budget à ${acc.name}`}
                      value={acc.linkedLineIds[0] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        update((s) => ({
                          ...s,
                          accounts: s.accounts.map((x) =>
                            x.id === acc.id ? { ...x, linkedLineIds: val ? [val] : [] } : x
                          ),
                        }));
                      }}
                      className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 sm:max-w-[170px]"
                    >
                      <option value="">Aucune ligne liée</option>
                      {savingsLines.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label} ({state.sheets.find((x) => x.id === l.sheetId)?.name})
                        </option>
                      ))}
                    </select>
                    <Button onClick={() => openSnapshot(acc)}>Relevé</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Objectifs d'épargne */}
      <Card
        title="Objectifs d'épargne"
        subtitle="Projets ciblés (vacances, travaux, apport…) suivis par rapport à vos livrets ou placements."
        action={
          <Button onClick={() => setGoalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Nouvel objectif
          </Button>
        }
      >
        {state.goals.length === 0 ? (
          <EmptyState>Aucun objectif défini.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {state.goals.map((g) => {
              const pool =
                g.accountIds.length > 0
                  ? state.accounts
                      .filter((a) => g.accountIds.includes(a.id))
                      .reduce((s, a) => s + accountBalance(a), 0)
                  : totalLivrets;
              const pct = g.target > 0 ? Math.min(1, pool / g.target) : 0;
              return (
                <div key={g.id} className="rounded-xl border border-slate-200 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold text-slate-900">
                      <Target className="h-4 w-4 text-indigo-600" />
                      {g.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => update((s) => ({ ...s, goals: s.goals.filter((x) => x.id !== g.id) }))}
                      className="text-slate-400 hover:text-rose-600"
                      aria-label={`Supprimer ${g.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-xs text-slate-500 tabular-nums">
                    <span>
                      Cible : <strong className="text-slate-900">{formatEuro(g.target, false)}</strong>
                    </span>
                    <span>{g.deadline ? `Échéance : ${g.deadline}` : 'Sans échéance'}</span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={pct} color={g.color} />
                  </div>
                  <p className="mt-1 text-right text-[11px] text-slate-500 tabular-nums">
                    {formatPct(pct, 0)} couvert ({formatEuro(Math.min(pool, g.target), false)})
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Projections long terme */}
      <Card
        title={`Projections d'épargne sur ${years} ans`}
        subtitle="Les versements comblent d'abord l'écart à la réserve de sécurité, puis capitalisent au taux annuel choisi."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={showConstantEuros}
                onChange={(e) => setShowConstantEuros(e.target.checked)}
              />
              En € constants (inflation {state.assumptions.inflation} %)
            </label>
          </div>
        }
      >
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Rendement central (%/an)">
            <MoneyInput
              value={state.assumptions.rateCentral}
              max={20}
              suffix="%"
              onChange={(v) => update((s) => ({ ...s, assumptions: { ...s.assumptions, rateCentral: v } }))}
            />
          </Field>
          <Field label="Inflation (%/an)">
            <MoneyInput
              value={state.assumptions.inflation}
              max={15}
              suffix="%"
              onChange={(v) => update((s) => ({ ...s, assumptions: { ...s.assumptions, inflation: v } }))}
            />
          </Field>
          <Field label="Effort progressif (+/mois)">
            <MoneyInput
              value={state.assumptions.progressiveExtra}
              onChange={(v) => update((s) => ({ ...s, assumptions: { ...s.assumptions, progressiveExtra: v } }))}
            />
          </Field>
          <Field label="Réserve cible (mois)">
            <MoneyInput
              value={state.assumptions.reserveMonths}
              max={24}
              suffix="m"
              onChange={(v) => update((s) => ({ ...s, assumptions: { ...s.assumptions, reserveMonths: v } }))}
            />
          </Field>
        </div>

        <LineChart series={projSeries} xLabels={xLabels} height={260} />

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {scenarios.map((sc, i) => {
            const finalVal = projSeries[i]?.values[years] ?? 0;
            return (
              <div key={sc.id} className="rounded-xl border border-slate-200 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sc.color }} />
                    {sc.label}
                  </span>
                  <span className="font-bold tabular-nums text-slate-700">{formatEuro(sc.monthly, false)} / mois</span>
                </div>
                <p className="mt-2 text-lg font-bold text-slate-900 tabular-nums">
                  <TrendingUp className="mr-1 inline h-4 w-4 text-emerald-600" />
                  {formatEuro(finalVal, false)}
                </p>
                <p className="text-[11px] text-slate-500">
                  à {years} ans · marge conservée {formatEuro(sc.keptMargin, false)}/m
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Crédits & échéances */}
      <Card
        title="Crédits & échéances"
        subtitle="Capital restant dû, amortissement et flux libéré à la fin de chaque prêt."
        action={
          <Button onClick={() => setLoanOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Ajouter un crédit
          </Button>
        }
      >
        {state.loans.length === 0 ? (
          <EmptyState>Aucun crédit renseigné.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {state.loans.map((loan) => {
              const info = computeLoan(loan, summary.monthly);
              const owner = state.sheets.find((s) => s.id === loan.ownerId);
              return (
                <div key={loan.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                        {owner?.name ?? 'Foyer'}
                      </span>
                      <h3 className="font-semibold text-slate-900">{loan.name}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => update((s) => ({ ...s, loans: s.loans.filter((x) => x.id !== loan.id) }))}
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label={`Supprimer ${loan.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <dl className="mt-3 space-y-1 text-xs tabular-nums">
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Restant dû estimé</dt>
                      <dd className="font-bold text-slate-900">{formatEuro(info.remainingNow)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Mensualité budget</dt>
                      <dd className="font-medium text-slate-800">{formatEuro(info.monthly)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Fin prévue</dt>
                      <dd className="text-slate-700">
                        {info.endLabel}
                        {info.monthsLeft != null ? ` (${info.monthsLeft} m)` : ''}
                      </dd>
                    </div>
                    {loan.rate != null && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Taux déclaré</dt>
                        <dd className="text-slate-700">{loan.rate.toFixed(2).replace('.', ',')} %</dd>
                      </div>
                    )}
                  </dl>
                  {info.progress != null && (
                    <div className="mt-3">
                      <ProgressBar value={info.progress} color="#0ea5e9" />
                      <p className="mt-1 text-right text-[11px] text-slate-500">
                        Amorti : {formatPct(info.progress)}
                      </p>
                    </div>
                  )}
                  {loan.note && <p className="mt-2 text-[11px] text-slate-400">{loan.note}</p>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Modales */}
      <Modal
        open={snapAccId !== null}
        onClose={() => setSnapAccId(null)}
        title="Enregistrer un relevé de solde"
        footer={
          <>
            <Button onClick={() => setSnapAccId(null)}>Annuler</Button>
            <Button variant="primary" onClick={saveSnapshot}>
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Date du relevé">
            <input type="date" max="2100-12-31" className={inputCls} value={snapDate} onChange={(e) => setSnapDate(e.target.value)} />
          </Field>
          <Field label="Solde constaté">
            <MoneyInput value={snapBalance} onChange={setSnapBalance} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={newAccOpen}
        onClose={() => setNewAccOpen(false)}
        title="Nouveau compte d'épargne"
        footer={
          <>
            <Button onClick={() => setNewAccOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={addAccount}>
              Créer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Titulaire">
            <select className={inputCls} value={accOwner} onChange={(e) => setAccOwner(e.target.value)}>
              {state.sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nom du support">
            <input className={inputCls} maxLength={80} value={accName} placeholder="ex : Livret A, PEA, Assurance-vie…" onChange={(e) => setAccName(e.target.value)} />
          </Field>
          <Field label="Type">
            <select className={inputCls} value={accType} onChange={(e) => setAccType(e.target.value as AccountType)}>
              <option value="livret">Livret disponible (réserve de sécurité)</option>
              <option value="placement">Placement long terme</option>
            </select>
          </Field>
          <Field label="Solde actuel">
            <MoneyInput value={accInit} onChange={setAccInit} />
          </Field>
          {accType === 'placement' && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={accCap} onChange={(e) => setAccCap(e.target.checked)} />
              Capitaliser au taux annuel dans les projections
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={goalOpen}
        onClose={() => setGoalOpen(false)}
        title="Nouvel objectif d'épargne"
        footer={
          <>
            <Button onClick={() => setGoalOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={addGoal}>
              Ajouter
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nom de l'objectif">
            <input className={inputCls} maxLength={80} value={goalName} placeholder="ex : Apport voiture, Travaux…" onChange={(e) => setGoalName(e.target.value)} />
          </Field>
          <Field label="Montant cible">
            <MoneyInput value={goalTarget} onChange={setGoalTarget} />
          </Field>
          <Field label="Échéance (optionnel)">
            <input type="month" max="2100-12" className={inputCls} value={goalDeadline} onChange={(e) => setGoalDeadline(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={loanOpen}
        onClose={() => setLoanOpen(false)}
        title="Ajouter un crédit"
        footer={
          <>
            <Button onClick={() => setLoanOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={addLoan}>
              Ajouter
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nom du crédit">
            <input className={inputCls} maxLength={80} value={loanForm.name ?? ''} onChange={(e) => setLoanForm({ ...loanForm, name: e.target.value })} />
          </Field>
          <Field label="Titulaire">
            <select className={inputCls} value={loanForm.ownerId} onChange={(e) => setLoanForm({ ...loanForm, ownerId: e.target.value })}>
              {state.sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Capital restant dû">
            <MoneyInput value={loanForm.remaining ?? 0} onChange={(v) => setLoanForm({ ...loanForm, remaining: v })} />
          </Field>
          <Field label="Ligne de mensualité associée">
            <select className={inputCls} value={loanForm.linkedLineId ?? ''} onChange={(e) => setLoanForm({ ...loanForm, linkedLineId: e.target.value })}>
              <option value="">Aucune</option>
              {debtLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} ({state.sheets.find((s) => s.id === l.sheetId)?.name})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date de fin prévue">
            <input type="date" max="2100-12-31" className={inputCls} value={loanForm.endDate ?? ''} onChange={(e) => setLoanForm({ ...loanForm, endDate: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
