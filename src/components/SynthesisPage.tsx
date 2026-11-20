import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CreditCard,
  LayoutGrid,
  PieChart,
  PiggyBank,
  Scale,
  Tag,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { BudgetState, SHEET_COLORS } from '../types';
import { HouseholdSummary, computeByCategory, computeByTag } from '../utils/calc';
import { computeProrata, computeReserve } from '../utils/finance';
import { formatEuro, formatPct } from '../utils/format';
import { Datum, Donut, HBars, StackedBar, Treemap } from './charts';
import { Button, Card, EmptyState, Kpi, Segmented } from './ui';
import { Updater } from './SheetPage';

interface Props {
  state: BudgetState;
  summary: HouseholdSummary;
  update: Updater;
  goTo: (tab: string) => void;
}

type VizMode = 'donut' | 'bars' | 'treemap';

export function SynthesisPage({ state, summary, update, goTo }: Props) {
  const [viz, setViz] = useState<VizMode>('donut');
  const [sheetFilter, setSheetFilter] = useState<string>('all');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [includeSavingsInViz, setIncludeSavingsInViz] = useState(false);

  const reserve = useMemo(() => computeReserve(state, summary), [state, summary]);

  const filteredCategories = useMemo(() => {
    const raw = computeByCategory(state, summary.monthly, sheetFilter === 'all' ? undefined : sheetFilter);
    return includeSavingsInViz ? raw : raw.filter((c) => c.category.id !== 'epargne');
  }, [state, summary.monthly, sheetFilter, includeSavingsInViz]);

  const chartData: Datum[] = useMemo(
    () =>
      filteredCategories.map((c) => ({
        id: c.category.id,
        label: c.category.label,
        value: c.amount,
        color: c.category.color,
      })),
    [filteredCategories]
  );

  const vizTotal = useMemo(() => chartData.reduce((s, d) => s + d.value, 0), [chartData]);

  // Répartition 50 / 30 / 20 (Besoins / Envies / Épargne)
  const bucketTotals = useMemo(() => {
    const all = computeByCategory(state, summary.monthly, sheetFilter === 'all' ? undefined : sheetFilter);
    let besoin = 0;
    let envie = 0;
    let epargne = 0;
    for (const c of all) {
      if (c.category.bucket === 'besoin') besoin += c.amount;
      else if (c.category.bucket === 'envie') envie += c.amount;
      else epargne += c.amount;
    }
    return { besoin, envie, epargne, total: besoin + envie + epargne };
  }, [state, summary.monthly, sheetFilter]);

  const selectedCatData = useMemo(
    () => filteredCategories.find((c) => c.category.id === selectedCat) ?? null,
    [filteredCategories, selectedCat]
  );

  const byTag = useMemo(
    () => computeByTag(state, summary.monthly, sheetFilter === 'all' ? undefined : sheetFilter),
    [state, summary.monthly, sheetFilter]
  );
  const selectedTagData = useMemo(
    () => byTag.find((t) => t.tag === selectedTag) ?? null,
    [byTag, selectedTag]
  );

  const commonProratas = useMemo(
    () =>
      state.sheets
        .filter((s) => s.kind === 'common')
        .map((c) => ({ sheet: c, data: computeProrata(state, summary, c.id) })),
    [state, summary]
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

  return (
    <div className="space-y-6">
      {/* KPIs principaux */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Revenus externes"
          value={formatEuro(summary.income)}
          hint={`dont ${formatEuro(summary.salaries, false)} de salaires`}
          icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
        />
        <Kpi
          label="Dépenses hors épargne"
          value={formatEuro(summary.spending)}
          hint={`${formatEuro(summary.spending * 12, false)} / an`}
          icon={<TrendingDown className="h-4 w-4 text-amber-600" />}
        />
        <Kpi
          label="Épargne budgétée"
          value={formatEuro(summary.savings)}
          hint={`Taux actuel : ${formatPct(summary.savingsRate)} (potentiel ${formatPct(summary.potentialSavingsRate)})`}
          tone="accent"
          icon={<PiggyBank className="h-4 w-4 text-indigo-600" />}
        />
        <Kpi
          label="Marge non affectée"
          value={formatEuro(summary.margin)}
          hint={`Capacité totale : ${formatEuro(summary.income - summary.spending)}`}
          tone={summary.margin >= 0 ? 'good' : 'bad'}
          icon={<Wallet className="h-4 w-4" />}
        />
        <Kpi
          label="Crédits / salaires"
          value={formatPct(summary.creditToSalary)}
          hint={`${formatEuro(summary.credits)} / mois de mensualités`}
          tone={summary.creditToSalary > 0.35 ? 'bad' : 'default'}
          icon={<CreditCard className="h-4 w-4 text-slate-500" />}
        />
      </div>

      {/* Budgets par personne / commun */}
      <section aria-label="Synthèse par budget">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Synthèse par budget</h2>
            <p className="text-xs text-slate-500">
              Cliquez sur un budget pour saisir ou modifier ses lignes de ressources, dépenses et dettes.
            </p>
          </div>
          {summary.transferControl !== 0 && (
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              Contrôle virements : {formatEuro(summary.transferControl)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {summary.sheets.map((sh) => {
            const color = SHEET_COLORS[sh.sheet.color];
            const pos = sh.soldeApresDettes >= 0;
            return (
              <button
                key={sh.sheet.id}
                type="button"
                onClick={() => goTo(sh.sheet.id)}
                className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:border-indigo-300 hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-white ${color.bg}`}>
                        {sh.sheet.kind === 'common' ? <Users className="h-4 w-4" /> : <User className="h-4 w-4" />}
                      </span>
                      <div>
                        <h3 className="font-semibold text-slate-900 group-hover:text-indigo-700">
                          Budget - {sh.sheet.name}
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          {sh.sheet.kind === 'common'
                            ? `Alimenté par ${sh.incoming.length} virement(s)`
                            : `Part des salaires : ${summary.salaries > 0 ? formatPct(sh.salaries / summary.salaries) : '—'}`}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
                        pos ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {formatEuro(sh.soldeApresDettes)}
                    </span>
                  </div>

                  <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Entrées de trésorerie</dt>
                      <dd className="font-semibold text-emerald-700 tabular-nums">{formatEuro(sh.totalResources)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Dépenses (hors épargne)</dt>
                      <dd className="font-medium text-slate-800 tabular-nums">
                        {formatEuro(sh.totalExpenses - sh.savings)}
                      </dd>
                    </div>
                    {sh.savings > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Épargne budgétée</dt>
                        <dd className="font-medium text-indigo-700 tabular-nums">{formatEuro(sh.savings)}</dd>
                      </div>
                    )}
                    {sh.totalDebts > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Dettes & virements sortants</dt>
                        <dd className="font-medium text-amber-700 tabular-nums">{formatEuro(sh.totalDebts)}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs font-medium text-indigo-600">
                  <span>Ouvrir la feuille de saisie</span>
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Visualisations par type de dépense */}
      <Card
        title="Visualisation des dépenses par type"
        subtitle="Explorez vos postes par catégorie en anneau, barres ou treemap — pour tout le foyer ou par budget."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filtrer par budget"
              value={sheetFilter}
              onChange={(e) => {
                setSheetFilter(e.target.value);
                setSelectedCat(null);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 outline-none focus:border-indigo-400"
            >
              <option value="all">Tout le foyer (consolidé)</option>
              {state.sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  Budget - {s.name}
                </option>
              ))}
            </select>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={includeSavingsInViz}
                onChange={(e) => setIncludeSavingsInViz(e.target.checked)}
              />
              Inclure l’épargne
            </label>
            <Segmented
              value={viz}
              onChange={setViz}
              options={[
                { id: 'donut', label: <><PieChart className="h-3.5 w-3.5" /> Anneau</> },
                { id: 'bars', label: <><BarChart3 className="h-3.5 w-3.5" /> Barres</> },
                { id: 'treemap', label: <><LayoutGrid className="h-3.5 w-3.5" /> Treemap</> },
              ]}
            />
          </div>
        }
      >
        {chartData.length === 0 ? (
          <EmptyState>Aucune dépense enregistrée sur ce périmètre.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-5">
              {viz === 'donut' && (
                <Donut
                  data={chartData}
                  centerLabel={sheetFilter === 'all' ? 'Total / mois' : state.sheets.find((s) => s.id === sheetFilter)?.name}
                  centerValue={formatEuro(vizTotal, false)}
                  selectedId={selectedCat}
                  onSelect={setSelectedCat}
                />
              )}
              {viz === 'bars' && (
                <HBars data={chartData} total={vizTotal} selectedId={selectedCat} onSelect={setSelectedCat} suffix="/m" />
              )}
              {viz === 'treemap' && (
                <Treemap data={chartData} height={290} selectedId={selectedCat} onSelect={setSelectedCat} />
              )}
            </div>

            <div className="space-y-4 lg:col-span-7">
              {viz !== 'bars' && (
                <HBars data={chartData} total={vizTotal} selectedId={selectedCat} onSelect={setSelectedCat} suffix="/m" />
              )}

              {selectedCatData && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedCatData.category.color }} />
                      Détail : {selectedCatData.category.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedCat(null)}
                      className="text-[11px] text-slate-500 hover:text-slate-800"
                    >
                      Fermer
                    </button>
                  </div>
                  <ul className="space-y-1 text-xs">
                    {selectedCatData.lines.map(({ line, amount }) => {
                      const sh = state.sheets.find((x) => x.id === line.sheetId);
                      return (
                        <li key={line.id} className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => goTo(line.sheetId)}
                            className="truncate text-left text-slate-700 hover:text-indigo-600 hover:underline"
                          >
                            {line.label} <span className="text-slate-400">({sh?.name})</span>
                          </button>
                          <span className="font-medium tabular-nums text-slate-900">{formatEuro(amount)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Règle 50 / 30 / 20 */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Structure 50 / 30 / 20 (Besoins · Envies · Épargne)</span>
                  <span className="text-slate-400">repère indicatif</span>
                </div>
                <StackedBar
                  height={16}
                  data={[
                    { id: 'besoin', label: 'Besoins (repère ~50 %)', value: bucketTotals.besoin, color: '#0ea5e9' },
                    { id: 'envie', label: 'Envies (repère ~30 %)', value: bucketTotals.envie, color: '#8b5cf6' },
                    { id: 'epargne', label: 'Épargne (repère ~20 %)', value: bucketTotals.epargne, color: '#22c55e' },
                  ]}
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Bas de synthèse : Prorata commun + Aperçu épargne/réserve */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {commonProratas.map(({ sheet, data }) => (
          <Card
            key={sheet.id}
            title={`Répartition du budget ${sheet.name}`}
            subtitle="Comparaison entre les versements actuels et le prorata des salaires"
            action={
              data.totalSalary > 0 && data.totalCurrent > 0 ? (
                <Button onClick={() => applyProrata(sheet.id)} title="Ajuster les virements au prorata exact des salaires">
                  <Scale className="h-3.5 w-3.5" /> Appliquer le prorata
                </Button>
              ) : null
            }
          >
            {data.rows.length === 0 ? (
              <EmptyState>Aucun virement configuré vers ce budget.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="border-b border-slate-100 text-[11px] text-slate-500 uppercase">
                    <tr>
                      <th className="py-2 pr-2">Personne</th>
                      <th className="py-2 px-2 text-right">Salaire</th>
                      <th className="py-2 px-2 text-right">Actuel</th>
                      <th className="py-2 px-2 text-right">Prorata</th>
                      <th className="py-2 pl-2 text-right">Écart</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {data.rows.map((r) => (
                      <tr key={r.sheet.id}>
                        <td className="py-2 pr-2 font-medium text-slate-900">{r.sheet.name}</td>
                        <td className="py-2 px-2 text-right text-slate-600">{formatEuro(r.salary, false)}</td>
                        <td className="py-2 px-2 text-right font-medium text-slate-900">{formatEuro(r.current)}</td>
                        <td className="py-2 px-2 text-right text-indigo-700">{formatEuro(r.prorata)}</td>
                        <td
                          className={`py-2 pl-2 text-right font-semibold ${
                            Math.abs(r.delta) < 1 ? 'text-emerald-600' : r.delta > 0 ? 'text-amber-700' : 'text-sky-700'
                          }`}
                        >
                          {r.delta >= 0 ? `+${formatEuro(r.delta)}` : formatEuro(r.delta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}

        <Card
          title="Réserve de sécurité & suivi d'épargne"
          subtitle={`Repère de ${state.assumptions.reserveMonths} mois de dépenses (${formatEuro(reserve.target, false)})`}
          action={
            <Button onClick={() => goTo('epargne')}>
              Ouvrir l’épargne <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm">
              <span className="text-slate-600">Livrets disponibles (agrégés)</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {formatEuro(reserve.livrets, false)}{' '}
                <span className="text-xs font-normal text-slate-500">({reserve.monthsCovered.toFixed(1)} mois)</span>
              </span>
            </div>
            {reserve.gap > 0 ? (
              <p className="text-xs text-amber-700">
                Écart au repère agrégé : <strong>{formatEuro(reserve.gap, false)}</strong>.
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Repère agrégé couvert.
              </p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {reserve.perPerson.map((p) => (
                <div key={p.sheetId} className="rounded-xl border border-slate-100 p-2.5 text-xs">
                  <p className="font-semibold text-slate-800">{p.name}</p>
                  <p className="mt-0.5 text-slate-500 tabular-nums">
                    {formatEuro(p.livrets, false)} · <strong>{p.monthsCovered.toFixed(1)} mois</strong> couverts
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Suivi par tags fins */}
      {byTag.length > 0 && (
        <Card
          title={
            <span className="inline-flex items-center gap-1.5">
              <Tag className="h-4 w-4 text-indigo-600" /> Suivi fin par tags
            </span>
          }
          subtitle="Regroupement transversal (ex : tous les abonnements, provisions, charges fixes…)"
        >
          <div className="flex flex-wrap gap-2">
            {byTag.map((t) => {
              const active = selectedTag === t.tag;
              return (
                <button
                  key={t.tag}
                  type="button"
                  onClick={() => setSelectedTag(active ? null : t.tag)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                    active
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-100'
                      : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="font-semibold">{t.tag}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 font-bold text-slate-900 tabular-nums shadow-2xs">
                    {formatEuro(t.amount)}
                  </span>
                  <span className="text-[11px] text-slate-400">({t.lines.length})</span>
                </button>
              );
            })}
          </div>
          {selectedTagData && (
            <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold text-indigo-950">
                  Postes tagués « {selectedTagData.tag} » · {formatEuro(selectedTagData.amount)} / mois ({formatEuro(selectedTagData.amount * 12, false)} / an)
                </span>
                <button type="button" onClick={() => setSelectedTag(null)} className="text-indigo-600 hover:underline">
                  Fermer
                </button>
              </div>
              <ul className="divide-y divide-indigo-100/70 text-xs">
                {selectedTagData.lines.map(({ line, amount }) => {
                  const sh = state.sheets.find((s) => s.id === line.sheetId);
                  return (
                    <li key={line.id} className="flex items-center justify-between py-1.5">
                      <span className="truncate pr-2 text-slate-800">
                        {line.label} <span className="text-slate-400">· {sh?.name}</span>
                      </span>
                      <span className="font-semibold text-slate-900 tabular-nums">{formatEuro(amount)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
