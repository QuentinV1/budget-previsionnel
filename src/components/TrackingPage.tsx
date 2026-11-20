import { useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Calculator, CalendarRange, FileUp, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { BankTransaction, BudgetState, MonthlyRecord } from '../types';
import { HouseholdSummary, computeByCategory } from '../utils/calc';
import { parseBankCsv } from '../utils/bankCsv';
import { formatEuro, formatPct } from '../utils/format';

function compoundSavings(monthly: number, annualRatePct: number, years: number): number {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r <= 0) return monthly * n;
  return monthly * ((Math.pow(1 + r, n) - 1) / r);
}
import { Button, Card, EmptyState, Field, Kpi, MoneyInput, ProgressBar, inputCls } from './ui';
import { Updater } from './SheetPage';

interface Props {
  state: BudgetState;
  summary: HouseholdSummary;
  update: Updater;
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function TrackingPage({ state, summary, update }: Props) {
  // ───────── Simulateur « Et si... » ─────────
  const [incomeDelta, setIncomeDelta] = useState(0);
  const [globalCutPct, setGlobalCutPct] = useState(0);
  const [extraSavings, setExtraSavings] = useState(0);
  const [removedLineIds, setRemovedLineIds] = useState<string[]>([]);

  const removableLines = useMemo(
    () =>
      state.lines
        .filter((l) => l.section !== 'resource' && l.group !== 'virements' && l.categoryId !== 'epargne')
        .map((l) => ({ line: l, amount: summary.monthly.get(l.id) ?? 0 }))
        .filter((x) => x.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    [state.lines, summary.monthly]
  );

  const sim = useMemo(() => {
    const removedSavings = removedLineIds.reduce((s, id) => s + (summary.monthly.get(id) ?? 0), 0);
    const baseSpending = Math.max(0, summary.spending - removedSavings);
    const simSpending = baseSpending * (1 - globalCutPct / 100);
    const simIncome = Math.max(0, summary.income + incomeDelta);
    const simSavings = Math.max(0, summary.savings + extraSavings);
    const simMargin = simIncome - simSpending - simSavings;
    const simSavingsRate = simIncome > 0 ? simSavings / simIncome : 0;
    const currentFv10 = compoundSavings(summary.savings, state.assumptions.rateCentral, 10);
    const simFv10 = compoundSavings(simSavings, state.assumptions.rateCentral, 10);
    return { simIncome, simSpending, simSavings, simMargin, simSavingsRate, currentFv10, simFv10 };
  }, [summary, incomeDelta, globalCutPct, extraSavings, removedLineIds, state.assumptions.rateCentral]);

  const resetSim = () => {
    setIncomeDelta(0);
    setGlobalCutPct(0);
    setExtraSavings(0);
    setRemovedLineIds([]);
  };

  // ───────── Historique mensuel & Prévisionnel vs Réel ─────────
  const records = state.monthlyRecords ?? [];
  const [selectedMonth, setSelectedMonth] = useState<string>(records[0]?.month ?? currentMonth());
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingTx, setPendingTx] = useState<BankTransaction[] | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  const activeRecord: MonthlyRecord = useMemo(() => {
    const existing = records.find((r) => r.month === selectedMonth);
    if (existing) return existing;
    return { month: selectedMonth, incomeActual: Math.round(summary.income * 100) / 100, actualsByCategory: {} };
  }, [records, selectedMonth, summary.income]);

  const upsertRecord = (next: MonthlyRecord) => {
    update((s) => {
      const list = s.monthlyRecords ?? [];
      const exists = list.some((r) => r.month === next.month);
      const updated = exists ? list.map((r) => (r.month === next.month ? next : r)) : [next, ...list];
      updated.sort((a, b) => b.month.localeCompare(a.month));
      return { ...s, monthlyRecords: updated };
    });
  };

  const deleteRecord = (month: string) => {
    update((s) => ({
      ...s,
      monthlyRecords: (s.monthlyRecords ?? []).filter((r) => r.month !== month),
    }));
  };

  const handleCsvFile = (file: File) => {
    setCsvError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseBankCsv(String(reader.result ?? ''), state.lines, state.categories);
      if (parsed.length === 0) {
        setCsvError('Aucune opération reconnue. Vérifiez les colonnes (Date, Libellé, Montant ou Débit/Crédit).');
        setPendingTx(null);
      } else {
        setPendingTx(parsed);
      }
    };
    reader.readAsText(file);
  };

  const applyPendingTx = () => {
    if (!pendingTx) return;
    const byCat: Record<string, number> = { ...activeRecord.actualsByCategory };
    let income = 0;
    for (const tx of pendingTx) {
      if (tx.type === 'income') {
        income += tx.amount;
      } else if (tx.categoryId) {
        byCat[tx.categoryId] = Math.round(((byCat[tx.categoryId] ?? 0) + tx.amount) * 100) / 100;
      }
    }
    upsertRecord({
      ...activeRecord,
      incomeActual: income > 0 ? Math.round(income * 100) / 100 : activeRecord.incomeActual,
      actualsByCategory: byCat,
      transactions: pendingTx,
    });
    setPendingTx(null);
  };

  const plannedByCat = useMemo(() => computeByCategory(state, summary.monthly), [state, summary.monthly]);
  const comparisonRows = useMemo(() => {
    return state.categories
      .filter((c) => c.id !== 'epargne')
      .map((cat) => {
        const planned = plannedByCat.find((p) => p.category.id === cat.id)?.amount ?? 0;
        const actual = activeRecord.actualsByCategory[cat.id] ?? 0;
        const delta = actual - planned;
        return { cat, planned, actual, delta };
      })
      .filter((r) => r.planned > 0 || r.actual > 0);
  }, [state.categories, plannedByCat, activeRecord.actualsByCategory]);

  const totalActualSpending = comparisonRows.reduce((s, r) => s + r.actual, 0);
  const totalSpendingDelta = totalActualSpending - summary.spending;

  return (
    <div className="space-y-6">
      {/* 1. Simulateur « Et si... » */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-indigo-600" /> Simulateur « Et si… »
          </span>
        }
        subtitle="Testez des scénarios sans modifier votre budget réel."
        action={
          <Button onClick={resetSim}>
            <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Variation des revenus (€ / mois)">
                <MoneyInput value={incomeDelta} min={-5000} max={20000} onChange={setIncomeDelta} ariaLabel="Variation des revenus" />
              </Field>
              <Field label="Effort d’épargne supplémentaire (€ / mois)">
                <MoneyInput value={extraSavings} min={0} max={20000} onChange={setExtraSavings} ariaLabel="Épargne supplémentaire" />
              </Field>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">Réduction globale des dépenses</span>
                <span className="font-bold text-indigo-700 tabular-nums">-{globalCutPct} %</span>
              </div>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={globalCutPct}
                onChange={(e) => setGlobalCutPct(Number(e.target.value))}
                className="w-full accent-indigo-600"
                aria-label="Réduction globale des dépenses en pourcentage"
              />
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Simuler la fin d’un crédit ou la coupure d’un gros poste :</p>
              <div className="grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-2">
                {removableLines.map(({ line, amount }) => {
                  const checked = removedLineIds.includes(line.id);
                  return (
                    <label key={line.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs hover:bg-slate-50">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setRemovedLineIds((prev) =>
                              prev.includes(line.id) ? prev.filter((x) => x !== line.id) : [...prev, line.id]
                            )
                          }
                        />
                        <span className="truncate">{line.label}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-slate-700 tabular-nums">{formatEuro(amount, false)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Kpi
                label="Dépenses simulées"
                value={formatEuro(sim.simSpending)}
                hint={`Actuel : ${formatEuro(summary.spending, false)} (${formatEuro(sim.simSpending - summary.spending)})`}
                icon={<Calculator className="h-4 w-4 text-amber-600" />}
              />
              <Kpi
                label="Marge simulée"
                value={formatEuro(sim.simMargin)}
                hint={`Actuel : ${formatEuro(summary.margin, false)}`}
                tone={sim.simMargin >= 0 ? 'good' : 'bad'}
                icon={sim.simMargin >= summary.margin ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              />
              <Kpi
                label="Taux d’épargne simulé"
                value={formatPct(sim.simSavingsRate)}
                hint={`Actuel : ${formatPct(summary.savingsRate)}`}
                tone="accent"
              />
              <Kpi
                label="Capital épargné à 10 ans"
                value={formatEuro(sim.simFv10, false)}
                hint={`Vs ${formatEuro(sim.currentFv10, false)} actuel (à ${state.assumptions.rateCentral} %)`}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Prévisionnel vs Réel & Import CSV bancaire */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-emerald-600" /> Historique mensuel — Prévisionnel vs Réel
          </span>
        }
        subtitle="Saisissez vos dépenses réelles du mois ou importez un relevé CSV bancaire."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              max="2100-12"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className={inputCls}
              aria-label="Mois suivi"
            />
            <Button onClick={() => fileRef.current?.click()}>
              <FileUp className="h-3.5 w-3.5 text-indigo-600" /> Importer CSV bancaire
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCsvFile(f);
                e.target.value = '';
              }}
            />
          </div>
        }
      >
        {csvError && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{csvError}</p>}

        {pendingTx && (
          <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-indigo-950">
                {pendingTx.length} opération(s) détectée(s) — vérifiez les catégories avant d’appliquer à {selectedMonth}
              </p>
              <div className="flex gap-2">
                <Button onClick={() => setPendingTx(null)}>Annuler</Button>
                <Button variant="primary" onClick={applyPendingTx}>
                  Appliquer au mois
                </Button>
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-indigo-100 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Date</th>
                    <th className="px-2 py-1.5">Libellé</th>
                    <th className="px-2 py-1.5 text-right">Montant</th>
                    <th className="px-2 py-1.5">Catégorie</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingTx.map((tx) => (
                    <tr key={tx.id}>
                      <td className="px-2 py-1 text-slate-500 tabular-nums">{tx.date}</td>
                      <td className="max-w-[220px] truncate px-2 py-1 font-medium text-slate-800">{tx.label}</td>
                      <td className={`px-2 py-1 text-right font-semibold tabular-nums ${tx.type === 'income' ? 'text-emerald-600' : 'text-slate-900'}`}>
                        {tx.type === 'income' ? '+' : '-'}{formatEuro(tx.amount)}
                      </td>
                      <td className="px-2 py-1">
                        {tx.type === 'income' ? (
                          <span className="text-[11px] text-emerald-700">Revenu</span>
                        ) : (
                          <select
                            value={tx.categoryId}
                            onChange={(e) =>
                              setPendingTx((prev) =>
                                prev ? prev.map((x) => (x.id === tx.id ? { ...x, categoryId: e.target.value } : x)) : null
                              )
                            }
                            className="rounded border border-slate-200 px-1.5 py-0.5 text-xs"
                          >
                            {state.categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 p-3">
            <span className="text-xs font-medium text-slate-500">Revenus réels ({selectedMonth})</span>
            <div className="mt-1">
              <MoneyInput
                value={activeRecord.incomeActual}
                onChange={(v) => upsertRecord({ ...activeRecord, incomeActual: v })}
                ariaLabel="Revenus réels du mois"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Prévu : {formatEuro(summary.income)}</p>
          </div>
          <Kpi
            label="Dépenses réelles saisies"
            value={formatEuro(totalActualSpending)}
            hint={`Prévu : ${formatEuro(summary.spending)}`}
          />
          <Kpi
            label="Écart global dépenses"
            value={totalSpendingDelta >= 0 ? `+${formatEuro(totalSpendingDelta)}` : formatEuro(totalSpendingDelta)}
            hint={totalSpendingDelta <= 0 ? 'Sous le budget prévu' : 'Dépassement du budget'}
            tone={totalSpendingDelta <= 0 ? 'good' : 'bad'}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-2 font-medium">Catégorie</th>
                <th className="px-2 py-2 text-right font-medium">Prévu (€)</th>
                <th className="px-2 py-2 text-right font-medium">Réel (€)</th>
                <th className="px-2 py-2 text-right font-medium">Écart</th>
                <th className="w-32 py-2 pl-2 font-medium">Avancement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {comparisonRows.map(({ cat, planned, actual, delta }) => {
                const ratio = planned > 0 ? actual / planned : actual > 0 ? 1 : 0;
                return (
                  <tr key={cat.id}>
                    <td className="py-2 pr-2 font-medium text-slate-800">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                        {cat.label}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right text-slate-600">{formatEuro(planned)}</td>
                    <td className="px-2 py-2 text-right">
                      <MoneyInput
                        value={actual}
                        onChange={(v) =>
                          upsertRecord({
                            ...activeRecord,
                            actualsByCategory: { ...activeRecord.actualsByCategory, [cat.id]: v },
                          })
                        }
                        className="ml-auto w-28"
                        ariaLabel={`Réel ${cat.label}`}
                      />
                    </td>
                    <td className={`px-2 py-2 text-right font-semibold ${delta <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {delta >= 0 ? `+${formatEuro(delta)}` : formatEuro(delta)}
                    </td>
                    <td className="py-2 pl-2">
                      <ProgressBar value={Math.min(1, ratio)} color={ratio <= 1 ? '#10b981' : '#ef4444'} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Historique des mois enregistrés */}
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">Mois enregistrés</h3>
          {records.length === 0 ? (
            <EmptyState>Aucun mois archivé pour l’instant. Modifiez un montant réel ci-dessus ou importez un CSV.</EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {records.map((r) => {
                const spent = Object.values(r.actualsByCategory).reduce((s, v) => s + v, 0);
                return (
                  <div
                    key={r.month}
                    className={`flex items-center justify-between rounded-xl border p-3 text-xs ${
                      r.month === selectedMonth ? 'border-indigo-400 bg-indigo-50/40' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <button type="button" onClick={() => setSelectedMonth(r.month)} className="text-left">
                      <p className="font-bold text-slate-900">{r.month}</p>
                      <p className="text-slate-500 tabular-nums">
                        Revenus : {formatEuro(r.incomeActual, false)} · Dépenses : {formatEuro(spent, false)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteRecord(r.month)}
                      aria-label={`Supprimer le mois ${r.month}`}
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
