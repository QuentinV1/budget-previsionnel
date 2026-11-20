import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Lightbulb, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { BudgetState, Lever } from '../types';
import { HouseholdSummary } from '../utils/calc';
import { computeProrata, leverCurrent, leverGain } from '../utils/finance';
import { computeScore, computeTips, TipLevel } from '../utils/tips';
import { createId, formatEuro, formatPct } from '../utils/format';
import { Gauge } from './charts';
import { Button, Card, EmptyState, Field, Modal, MoneyInput, ProgressBar, inputCls } from './ui';
import { Updater } from './SheetPage';

interface Props {
  state: BudgetState;
  summary: HouseholdSummary;
  update: Updater;
  goTo: (tab: string) => void;
}

const LEVEL_STYLES: Record<TipLevel, { cls: string; icon: typeof Info; label: string }> = {
  alerte: { cls: 'border-rose-200 bg-rose-50/70 text-rose-900', icon: AlertTriangle, label: 'Alerte' },
  attention: { cls: 'border-amber-200 bg-amber-50/70 text-amber-900', icon: AlertTriangle, label: 'À surveiller' },
  conseil: { cls: 'border-indigo-200 bg-indigo-50/60 text-indigo-950', icon: Lightbulb, label: 'Recommandation' },
  ok: { cls: 'border-emerald-200 bg-emerald-50/60 text-emerald-950', icon: CheckCircle2, label: 'Point positif' },
};

export function TipsPage({ state, summary, update, goTo }: Props) {
  const [newLeverOpen, setNewLeverOpen] = useState(false);
  const [leverLabel, setLeverLabel] = useState('');
  const [leverReduction, setLeverReduction] = useState(30);
  const [leverAction, setLeverAction] = useState('');
  const [leverLines, setLeverLines] = useState<string[]>([]);

  const { score, parts } = useMemo(() => computeScore(state, summary), [state, summary]);
  const allTips = useMemo(() => computeTips(state, summary), [state, summary]);
  const visibleTips = useMemo(
    () => allTips.filter((t) => !state.dismissedTips.includes(t.id)),
    [allTips, state.dismissedTips]
  );

  const applyProrata = (targetSheetId: string) => {
    const pr = computeProrata(state, summary, targetSheetId);
    update((s) => ({
      ...s,
      lines: s.lines.map((l) => {
        const row = pr.rows.find((r) => r.lineIds.includes(l.id));
        if (!row || row.lineIds[0] !== l.id) return l;
        return { ...l, mode: 'monthly', amount: Math.round(row.prorata * 100) / 100 };
      }),
    }));
  };

  const totalCurrentLevers = state.levers.reduce((s, l) => s + leverCurrent(l, summary.monthly), 0);
  const totalGainLevers = state.levers.reduce((s, l) => s + leverGain(l, summary.monthly), 0);

  const addLever = () => {
    if (!leverLabel.trim()) return;
    const lever: Lever = {
      id: createId('lev'),
      label: leverLabel.trim(),
      lineIds: leverLines,
      reduction: leverReduction,
      action: leverAction.trim(),
    };
    update((s) => ({ ...s, levers: [...s.levers, lever] }));
    setLeverLabel('');
    setLeverAction('');
    setLeverLines([]);
    setNewLeverOpen(false);
  };

  const expenseLines = state.lines.filter((l) => l.section === 'expense' && l.categoryId !== 'epargne');

  return (
    <div className="space-y-6">
      {/* Score & piliers */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Indice de santé budgétaire" subtitle="Synthèse indicative basée sur 4 repères">
          <Gauge value={score} />
          <p className="mt-2 text-center text-xs text-slate-500">
            {score >= 75
              ? 'Situation globalement saine et équilibrée.'
              : score >= 50
                ? 'Quelques marges de manœuvre à optimiser.'
                : 'Points de vigilance à traiter en priorité.'}
          </p>
        </Card>

        <Card title="Détail des 4 piliers" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {parts.map((p) => (
              <div key={p.label} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">{p.label}</span>
                  <span className="font-bold text-slate-700 tabular-nums">{formatPct(p.value, 0)}</span>
                </div>
                <ProgressBar value={p.value} color={p.value >= 0.75 ? '#10b981' : p.value >= 0.5 ? '#f59e0b' : '#ef4444'} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Capacité d’épargne actuelle : <strong>{formatEuro(summary.savings)}</strong> / mois · Potentielle (avec marge non affectée) :{' '}
            <strong>{formatEuro(summary.income - summary.spending)}</strong> / mois.
          </p>
        </Card>
      </div>

      {/* Recommandations dynamiques */}
      <Card
        title="Recommandations personnalisées"
        subtitle="Calculées automatiquement à partir de vos budgets, livrets et crédits."
        action={
          state.dismissedTips.length > 0 ? (
            <Button onClick={() => update((s) => ({ ...s, dismissedTips: [] }))}>
              <RotateCcw className="h-3.5 w-3.5" /> Réafficher ({state.dismissedTips.length})
            </Button>
          ) : null
        }
      >
        {visibleTips.length === 0 ? (
          <EmptyState>Aucune recommandation active.</EmptyState>
        ) : (
          <div className="space-y-3">
            {visibleTips.map((tip) => {
              const st = LEVEL_STYLES[tip.level];
              const Icon = st.icon;
              return (
                <div key={tip.id} className={`flex items-start gap-3 rounded-xl border p-3.5 ${st.cls}`}>
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold tracking-wider uppercase opacity-75">{st.label}</span>
                      {tip.gain != null && tip.gain > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 tabular-nums">
                          <Sparkles className="h-3 w-3" /> +{formatEuro(tip.gain, false)} / mois
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm font-semibold">{tip.title}</p>
                    <p className="mt-1 text-xs leading-relaxed opacity-90">{tip.detail}</p>
                    {tip.action && (
                      <div className="mt-2">
                        <Button
                          onClick={() => {
                            if (tip.action?.kind === 'prorata' && tip.action.target) applyProrata(tip.action.target);
                            if (tip.action?.kind === 'goto' && tip.action.target) goTo(tip.action.target);
                          }}
                        >
                          {tip.action.label}
                        </Button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => update((s) => ({ ...s, dismissedTips: [...s.dismissedTips, tip.id] }))}
                    className="rounded p-1 opacity-50 hover:bg-black/5 hover:opacity-100"
                    aria-label="Masquer cette recommandation"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Plan d'action & leviers */}
      <Card
        title="Plan d'action — Leviers d'optimisation"
        subtitle="Hypothèses d'économies mensuelles alimentant le scénario « Optimisée » dans l'onglet Épargne."
        action={
          <Button variant="primary" onClick={() => setNewLeverOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Ajouter un levier
          </Button>
        }
      >
        {state.levers.length === 0 ? (
          <EmptyState>Aucun levier défini.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-slate-100 text-[11px] text-slate-500 uppercase">
                <tr>
                  <th className="py-2 pr-2">Levier</th>
                  <th className="py-2 px-2 text-right">Actuel / mois</th>
                  <th className="py-2 px-2 text-right">Baisse visée</th>
                  <th className="py-2 px-2 text-right">Budget cible</th>
                  <th className="hidden py-2 px-2 md:table-cell">Action proposée</th>
                  <th className="py-2 pl-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {state.levers.map((lev) => {
                  const cur = leverCurrent(lev, summary.monthly);
                  const gain = leverGain(lev, summary.monthly);
                  return (
                    <tr key={lev.id}>
                      <td className="py-2.5 pr-2 font-medium text-slate-900">{lev.label}</td>
                      <td className="py-2.5 px-2 text-right text-slate-600">{formatEuro(cur)}</td>
                      <td className="py-2.5 px-2 text-right">
                        <MoneyInput
                          value={lev.reduction}
                          max={cur || 10000}
                          onChange={(v) =>
                            update((s) => ({
                              ...s,
                              levers: s.levers.map((x) => (x.id === lev.id ? { ...x, reduction: v } : x)),
                            }))
                          }
                          className="ml-auto w-24"
                        />
                      </td>
                      <td className="py-2.5 px-2 text-right font-semibold text-emerald-700">
                        {formatEuro(Math.max(0, cur - gain))}
                      </td>
                      <td className="hidden py-2.5 px-2 text-xs text-slate-500 md:table-cell">{lev.action}</td>
                      <td className="py-2.5 pl-2 text-right">
                        <button
                          type="button"
                          onClick={() => update((s) => ({ ...s, levers: s.levers.filter((x) => x.id !== lev.id) }))}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Supprimer ${lev.label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50/70 font-semibold">
                  <td className="py-2.5 pr-2 text-slate-900">TOTAL</td>
                  <td className="py-2.5 px-2 text-right text-slate-700">{formatEuro(totalCurrentLevers)}</td>
                  <td className="py-2.5 px-2 text-right text-indigo-700">{formatEuro(totalGainLevers)}</td>
                  <td className="py-2.5 px-2 text-right text-emerald-700">
                    {formatEuro(Math.max(0, totalCurrentLevers - totalGainLevers))}
                  </td>
                  <td className="hidden py-2.5 px-2 text-xs font-normal text-slate-500 md:table-cell">
                    Gain annuel potentiel : {formatEuro(totalGainLevers * 12, false)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={newLeverOpen}
        onClose={() => setNewLeverOpen(false)}
        title="Nouveau levier d'économie"
        wide
        footer={
          <>
            <Button onClick={() => setNewLeverOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={addLever}>
              Ajouter
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nom du levier">
            <input className={inputCls} maxLength={80} value={leverLabel} placeholder="ex : Énergie, Transport…" onChange={(e) => setLeverLabel(e.target.value)} />
          </Field>
          <Field label="Baisse mensuelle visée">
            <MoneyInput value={leverReduction} onChange={setLeverReduction} />
          </Field>
          <Field label="Action proposée">
            <input className={inputCls} maxLength={120} value={leverAction} onChange={(e) => setLeverAction(e.target.value)} />
          </Field>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Lignes de dépenses concernées :</p>
            <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
              {expenseLines.map((l) => (
                <label key={l.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={leverLines.includes(l.id)}
                    onChange={(e) =>
                      setLeverLines(
                        e.target.checked ? [...leverLines, l.id] : leverLines.filter((x) => x !== l.id)
                      )
                    }
                  />
                  <span className="truncate">{l.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
