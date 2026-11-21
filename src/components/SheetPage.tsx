import { useMemo, useState } from 'react';
import { ArrowRightLeft, Calendar, Copy, Landmark, MoreHorizontal, Percent, Plus, Tag, Trash2, User, Users, X } from 'lucide-react';
import {
  BudgetLine,
  BudgetState,
  DEBT_GROUPS,
  EXPENSE_GROUPS,
  LineGroup,
  PRESET_TAGS,
  RESOURCE_GROUPS,
  SHEET_COLORS,
  Section,
  Sheet,
} from '../types';
import { HouseholdSummary, computeByCategory } from '../utils/calc';
import { createId, formatEuro, formatPct } from '../utils/format';
import { StackedBar } from './charts';
import { Button, Field, MoneyInput, Modal, Segmented, TextInput, inputCls } from './ui';

export type Updater = (fn: (s: BudgetState) => BudgetState) => void;

interface Props {
  state: BudgetState;
  sheet: Sheet;
  summary: HouseholdSummary;
  update: Updater;
  removeLines: (ids: string[], label: string) => void;
  goTo: (tab: string) => void;
}

function newLine(sheetId: string, section: Section, group: LineGroup, categoryId: string, extra: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: createId('l'),
    sheetId,
    section,
    group,
    label: '',
    comment: '',
    mode: 'monthly',
    amount: 0,
    annualAmount: 0,
    share: 100,
    percent: 100,
    refLineIds: [],
    categoryId,
    ...extra,
  };
}

export function SheetPage({ state, sheet, summary, update, removeLines, goTo }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string>('all');
  const sum = summary.sheets.find((s) => s.sheet.id === sheet.id)!;
  const lines = state.lines.filter((l) => l.sheetId === sheet.id);
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) for (const t of l.tags ?? []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [lines]);
  const m = (id: string) => summary.monthly.get(id) ?? 0;
  const color = SHEET_COLORS[sheet.color];

  const patchLine = (id: string, patch: Partial<BudgetLine>) =>
    update((s) => ({ ...s, lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const addLine = (section: Section, group: LineGroup) => {
    const def =
      section === 'expense'
        ? EXPENSE_GROUPS.find((g) => g.id === group)?.defaultCategory ?? 'autres'
        : section === 'debt' && group === 'credits'
          ? 'autres'
          : '';
    const target = group === 'virements' ? state.sheets.find((s) => s.kind === 'common' && s.id !== sheet.id)?.id ?? state.sheets.find((s) => s.id !== sheet.id)?.id : undefined;
    const line = newLine(sheet.id, section, group, def, target ? { targetSheetId: target, label: `Virement ${state.sheets.find((s) => s.id === target)?.name ?? ''}` } : {});
    update((s) => {
      // insérer après la dernière ligne du même groupe pour garder l'ordre
      const idx = s.lines.map((l) => l.sheetId === sheet.id && l.group === group).lastIndexOf(true);
      const next = [...s.lines];
      next.splice(idx >= 0 ? idx + 1 : next.length, 0, line);
      return { ...s, lines: next };
    });
    setFocusId(line.id);
  };

  const spendingByType = useMemo(() => computeByCategory(state, summary.monthly, sheet.id), [state, summary.monthly, sheet.id]);
  const editing = lines.find((l) => l.id === editingId) ?? null;

  const rowProps = { state, sheet, monthly: m, patchLine, onEdit: setEditingId, onDelete: (l: BudgetLine) => removeLines([l.id], l.label || 'Ligne'), focusId };

  return (
    <div className="space-y-5">
      {/* En-tête de la feuille */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-xs ${color.bg}`}>
            {sheet.kind === 'common' ? <Users className="h-5 w-5" /> : <User className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Budget prévisionnel</p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Budget - {sheet.name}</h1>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Montants mensuels · cliquez sur un montant pour le modifier · <MoreHorizontal className="inline h-3.5 w-3.5" /> pour plus d’options (annuel, %, commentaire)
        </p>
      </div>

      {/* Bandeau des totaux (comme le bas de la feuille Excel) */}
      <div className="-mx-3 border-y border-slate-200 bg-white/95 px-3 py-3 backdrop-blur sm:sticky sm:top-[61px] sm:z-20 sm:mx-0 sm:rounded-2xl sm:border sm:px-4 sm:shadow-xs">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
          <Total label="Total ressources" value={sum.totalResources} tone="text-emerald-700" />
          <Total label="Total dépenses" value={sum.totalExpenses} tone="text-slate-900" />
          <Total label="Solde" value={sum.solde} tone={sum.solde >= 0 ? 'text-slate-900' : 'text-rose-600'} />
          <Total label="Total dettes" value={sum.totalDebts} tone="text-amber-700" />
          <div className={`col-span-2 rounded-xl px-3 py-1.5 sm:col-span-1 ${sum.soldeApresDettes >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
            <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Solde après dettes</p>
            <p className={`text-lg font-bold tabular-nums ${sum.soldeApresDettes >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatEuro(sum.soldeApresDettes)}</p>
          </div>
        </div>
        {spendingByType.length > 0 && (
          <div className="mt-2.5 hidden sm:block">
            <StackedBar height={8} showLabels={false} data={spendingByType.map((c) => ({ id: c.category.id, label: c.category.label, value: c.amount, color: c.category.color }))} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Colonne gauche : ressources + dettes */}
        <div className="space-y-5">
          <Block title="Ressources" total={sum.totalResources} accent="text-emerald-700">
            {sum.incoming.length > 0 && (
              <Group label="Virements reçus" subtotal={sum.transfersIn}>
                {sum.incoming.map((t) => (
                  <div key={t.line.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-sm sm:flex-nowrap">
                    <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-slate-700">{t.fromSheet?.name ?? '?'}</span>
                    <button type="button" onClick={() => goTo(t.line.sheetId)} className="shrink-0 text-[11px] text-indigo-600 hover:underline">
                      modifier dans Budget - {t.fromSheet?.name}
                    </button>
                    <span className="w-auto shrink-0 text-right font-medium tabular-nums text-slate-900 sm:w-28">{formatEuro(t.amount)}</span>
                    <span className="hidden sm:inline-block sm:w-14" />
                  </div>
                ))}
              </Group>
            )}
            {RESOURCE_GROUPS.map((g) => {
              const gl = lines.filter((l) => l.section === 'resource' && l.group === g.id);
              return (
                <Group key={g.id} label={g.label} subtotal={gl.reduce((s, l) => s + m(l.id), 0)} onAdd={() => addLine('resource', g.id)} collapsedWhenEmpty>
                  {gl.map((l) => (
                    <LineRow key={l.id} line={l} {...rowProps} />
                  ))}
                </Group>
              );
            })}
          </Block>

          <Block title="Dettes & virements" total={sum.totalDebts} accent="text-amber-700" subtitle="Crédits et virements vers un autre budget (ex : compte commun)">
            {DEBT_GROUPS.map((g) => {
              const gl = lines.filter((l) => l.section === 'debt' && l.group === g.id);
              return (
                <Group key={g.id} label={g.label} subtotal={gl.reduce((s, l) => s + m(l.id), 0)} onAdd={() => addLine('debt', g.id)} collapsedWhenEmpty>
                  {gl.map((l) => (
                    <LineRow key={l.id} line={l} {...rowProps} />
                  ))}
                </Group>
              );
            })}
          </Block>

          {sum.totalResources > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-xs">
              <p className="mb-2 font-semibold text-slate-900">Lecture rapide</p>
              <ul className="space-y-1 text-slate-600">
                {sum.savings > 0 && (
                  <li>
                    Épargne : <strong className="text-slate-900">{formatEuro(sum.savings)}</strong> / mois ({formatPct(sum.savings / Math.max(1, sum.externalIncome || sum.totalResources))} des revenus)
                  </li>
                )}
                {sum.transfersOut > 0 && (
                  <li>
                    Virements vers les budgets communs : <strong className="text-slate-900">{formatEuro(sum.transfersOut)}</strong> ({formatPct(sum.transfersOut / sum.totalResources)} des ressources)
                  </li>
                )}
                {spendingByType[0] && spendingByType[0].category.id !== 'epargne' && (
                  <li>
                    Premier poste : <strong className="text-slate-900">{spendingByType[0].category.label}</strong> ({formatEuro(spendingByType[0].amount)})
                  </li>
                )}
                <li>
                  Reste après tout : <strong className={sum.soldeApresDettes >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{formatEuro(sum.soldeApresDettes)}</strong> soit {formatEuro(sum.soldeApresDettes * 12, false)} / an
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* Colonne droite : dépenses */}
        <Block title="Dépenses" total={sum.totalExpenses} accent="text-slate-900">
          {availableTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                <Tag className="h-3 w-3" /> Tags :
              </span>
              <button
                type="button"
                onClick={() => setTagFilter('all')}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                  tagFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Tous
              </button>
              {availableTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(tagFilter === t ? 'all' : t)}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                    tagFilter === t ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {EXPENSE_GROUPS.map((g) => {
            const gl = lines.filter(
              (l) => l.section === 'expense' && l.group === g.id && (tagFilter === 'all' || (l.tags ?? []).includes(tagFilter))
            );
            if (tagFilter !== 'all' && gl.length === 0) return null;
            return (
              <Group key={g.id} label={g.label} subtotal={gl.reduce((s, l) => s + m(l.id), 0)} onAdd={() => addLine('expense', g.id)} collapsedWhenEmpty>
                {gl.map((l) => (
                  <LineRow key={l.id} line={l} {...rowProps} />
                ))}
              </Group>
            );
          })}
        </Block>
      </div>

      <LineEditor
        state={state}
        line={editing}
        monthly={m}
        onClose={() => setEditingId(null)}
        patch={(p) => editing && patchLine(editing.id, p)}
        onDuplicate={() => {
          if (!editing) return;
          const copy = { ...editing, id: createId('l'), label: `${editing.label} (copie)` };
          update((s) => {
            const idx = s.lines.findIndex((l) => l.id === editing.id);
            const next = [...s.lines];
            next.splice(idx + 1, 0, copy);
            return { ...s, lines: next };
          });
          setEditingId(copy.id);
        }}
        onDelete={() => {
          if (!editing) return;
          removeLines([editing.id], editing.label || 'Ligne');
          setEditingId(null);
        }}
      />
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="px-1 py-1.5">
      <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</p>
      <p className={`text-base font-bold tabular-nums sm:text-lg ${tone}`}>{formatEuro(value)}</p>
    </div>
  );
}

function Block({ title, total, accent, subtitle, children }: { title: string; total: number; accent: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold tracking-wider text-slate-800 uppercase">{title}</h2>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        <span className={`text-base font-bold tabular-nums ${accent}`}>{formatEuro(total)}</span>
      </header>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

function Group({ label, subtotal, onAdd, children, collapsedWhenEmpty }: { label: string; subtotal: number; onAdd?: () => void; children: React.ReactNode; collapsedWhenEmpty?: boolean }) {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0;
  const empty = count === 0;
  return (
    <div className={`px-2 py-2 sm:px-3 ${empty && collapsedWhenEmpty ? 'bg-white' : ''}`}>
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <span className={`text-[11px] font-semibold tracking-wider uppercase ${empty ? 'text-slate-300' : 'text-slate-500'}`}>{label}</span>
        <div className="flex items-center gap-2">
          {!empty && <span className="text-xs font-medium text-slate-500 tabular-nums">{formatEuro(subtotal)}</span>}
          {onAdd && (
            <button type="button" onClick={onAdd} className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50" aria-label={`Ajouter dans ${label}`}>
              <Plus className="h-3 w-3" /> Ajouter
            </button>
          )}
        </div>
      </div>
      {!empty && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

interface RowProps {
  line: BudgetLine;
  state: BudgetState;
  sheet: Sheet;
  monthly: (id: string) => number;
  patchLine: (id: string, p: Partial<BudgetLine>) => void;
  onEdit: (id: string) => void;
  onDelete: (l: BudgetLine) => void;
  focusId: string | null;
}

function LineRow({ line, state, sheet, monthly, patchLine, onEdit, onDelete, focusId }: RowProps) {
  const cat = state.categories.find((c) => c.id === line.categoryId);
  const value = monthly(line.id);
  const isTransfer = line.group === 'virements';
  const showCategory = line.section !== 'resource' && !isTransfer;
  const zero = value === 0;

  return (
    <div className={`group grid grid-cols-[minmax(0,1fr)_108px_auto] items-center gap-x-2 gap-y-1 rounded-lg px-1 py-0.5 hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_150px_128px_56px] ${zero ? 'opacity-70' : ''}`}>
      <div className="col-span-3 min-w-0 sm:col-span-1">
        <div className="flex items-center gap-1.5">
          {showCategory && <span className="ml-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cat?.color ?? '#cbd5e1' }} />}
          {isTransfer && <ArrowRightLeft className="ml-1 h-3.5 w-3.5 shrink-0 text-slate-400" />}
          <TextInput
            value={line.label}
            onChange={(v) => patchLine(line.id, { label: v })}
            placeholder="Libellé…"
            ariaLabel="Libellé"
            className={focusId === line.id ? 'ring-2 ring-indigo-100' : ''}
          />
        </div>
        {(line.comment || (line.tags && line.tags.length > 0)) && (
          <div className="-mt-0.5 flex flex-wrap items-center gap-1 pl-6">
            {line.tags?.map((t) => (
              <span key={t} className="rounded bg-indigo-50 px-1.5 py-0 text-[10px] font-medium text-indigo-700">
                {t}
              </span>
            ))}
            {line.comment && <p className="truncate text-[11px] text-slate-400 italic">{line.comment}</p>}
          </div>
        )}
      </div>

      <div className="min-w-0">
        {showCategory ? (
          <select
            aria-label="Type"
            value={line.categoryId}
            onChange={(e) => patchLine(line.id, { categoryId: e.target.value })}
            className="w-full truncate rounded-lg border border-transparent bg-transparent py-1 pr-1 pl-1.5 text-xs text-slate-600 outline-none hover:border-slate-200 focus:border-indigo-400"
          >
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        ) : isTransfer ? (
          <select
            aria-label="Budget destinataire"
            value={line.targetSheetId ?? ''}
            onChange={(e) => patchLine(line.id, { targetSheetId: e.target.value })}
            className="w-full rounded-lg border border-transparent bg-transparent py-1 pr-1 pl-1.5 text-xs text-slate-600 outline-none hover:border-slate-200 focus:border-indigo-400"
          >
            <option value="">— destinataire —</option>
            {state.sheets.filter((s) => s.id !== sheet.id).map((s) => (
              <option key={s.id} value={s.id}>
                → Budget - {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="hidden sm:block" />
        )}
      </div>

      <div className="flex items-center gap-1 sm:block">
        {line.mode === 'monthly' && <MoneyInput value={line.amount} onChange={(v) => patchLine(line.id, { amount: v })} ariaLabel={`Montant ${line.label}`} />}
        {line.mode === 'annual' && (
          <button type="button" onClick={() => onEdit(line.id)} className="w-full rounded-lg border border-dashed border-slate-200 px-2 py-1 text-right hover:border-indigo-300" title="Montant annuel lissé">
            <span className="block text-sm font-medium tabular-nums text-slate-900">{formatEuro(value)}</span>
            <span className="flex items-center justify-end gap-1 text-[10px] text-slate-400">
              <Calendar className="h-2.5 w-2.5" /> {formatEuro(line.annualAmount, false)}/an{line.share !== 100 ? ` × ${line.share} %` : ''}
            </span>
          </button>
        )}
        {line.mode === 'percent' && (
          <button type="button" onClick={() => onEdit(line.id)} className="w-full rounded-lg border border-dashed border-slate-200 px-2 py-1 text-right hover:border-indigo-300" title="Calculé automatiquement">
            <span className="block text-sm font-medium tabular-nums text-slate-900">{formatEuro(value)}</span>
            <span className="flex items-center justify-end gap-1 text-[10px] text-slate-400">
              <Percent className="h-2.5 w-2.5" /> {line.percent} % de {line.refLineIds.length} ligne(s)
            </span>
          </button>
        )}
      </div>

      <div className="flex items-center justify-end gap-0.5 sm:opacity-40 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <button type="button" onClick={() => onEdit(line.id)} className="rounded-md p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800" aria-label="Options de la ligne" title="Options (annuel, %, commentaire…)">
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onDelete(line)} className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Supprimer la ligne" title="Supprimer">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function LineEditor({ state, line, monthly, onClose, patch, onDuplicate, onDelete }: { state: BudgetState; line: BudgetLine | null; monthly: (id: string) => number; onClose: () => void; patch: (p: Partial<BudgetLine>) => void; onDuplicate: () => void; onDelete: () => void }) {
  const [customTag, setCustomTag] = useState('');
  if (!line) return null;
  const groups = line.section === 'resource' ? RESOURCE_GROUPS : line.section === 'expense' ? EXPENSE_GROUPS : DEBT_GROUPS;
  const isTransfer = line.group === 'virements';
  const candidates = state.lines.filter((l) => l.sheetId === line.sheetId && l.id !== line.id && l.mode !== 'percent');
  const value = monthly(line.id);
  const currentTags = line.tags ?? [];
  const toggleTag = (t: string) => {
    const next = currentTags.includes(t) ? currentTags.filter((x) => x !== t) : [...currentTags, t];
    patch({ tags: next });
  };
  const addCustomTag = () => {
    const trimmed = customTag.trim();
    if (!trimmed) return;
    if (!currentTags.includes(trimmed)) patch({ tags: [...currentTags, trimmed] });
    setCustomTag('');
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={line.label || 'Nouvelle ligne'}
      wide
      footer={
        <>
          <Button variant="danger" onClick={onDelete} className="mr-auto">
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </Button>
          <Button onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" /> Dupliquer
          </Button>
          <Button variant="primary" onClick={onClose}>
            Terminé
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Libellé">
          <input className={inputCls} value={line.label} maxLength={80} onChange={(e) => patch({ label: e.target.value })} />
        </Field>
        <Field label="Commentaire">
          <input className={inputCls} value={line.comment} maxLength={140} placeholder="ex : Provision, à confirmer…" onChange={(e) => patch({ comment: e.target.value })} />
        </Field>
        <Field label="Budget">
          <select
            className={inputCls}
            value={line.sheetId}
            onChange={(e) => patch({ sheetId: e.target.value, refLineIds: [], targetSheetId: line.targetSheetId === e.target.value ? undefined : line.targetSheetId })}
          >
            {state.sheets.map((s) => (
              <option key={s.id} value={s.id}>
                Budget - {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rubrique">
          <select className={inputCls} value={line.group} onChange={(e) => patch({ group: e.target.value as LineGroup, ...(e.target.value === 'placements' ? { categoryId: 'epargne' } : {}) })}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        {line.section !== 'resource' && !isTransfer && (
          <>
            <Field label="Type (pour la synthèse)">
              <select className={inputCls} value={line.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
                {state.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Tags fins (ex : Abonnement, Fixe, Provision…)</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {PRESET_TAGS.map((t) => {
                  const active = currentTags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        active ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
                {currentTags
                  .filter((t) => !(PRESET_TAGS as readonly string[]).includes(t))
                  .map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
                    >
                      {t} <X className="h-3 w-3" />
                    </button>
                  ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  className={inputCls}
                  maxLength={30}
                  value={customTag}
                  placeholder="Ajouter un tag personnalisé…"
                  onChange={(e) => setCustomTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomTag();
                    }
                  }}
                />
                <Button onClick={addCustomTag}>Ajouter</Button>
              </div>
            </div>
          </>
        )}
        {isTransfer && (
          <Field label="Budget destinataire">
            <select className={inputCls} value={line.targetSheetId ?? ''} onChange={(e) => patch({ targetSheetId: e.target.value })}>
              <option value="">—</option>
              {state.sheets.filter((s) => s.id !== line.sheetId).map((s) => (
                <option key={s.id} value={s.id}>
                  Budget - {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600">Calcul du montant</span>
          <Segmented
            value={line.mode}
            onChange={(mode) => {
              const p: Partial<BudgetLine> = { mode };
              if (mode === 'annual' && !line.annualAmount) p.annualAmount = Math.round(value * 12 * 100) / 100;
              if (mode === 'monthly') p.amount = value;
              patch(p);
            }}
            options={[
              { id: 'monthly', label: 'Mensuel' },
              { id: 'annual', label: 'Annuel lissé' },
              { id: 'percent', label: '% d’autres lignes' },
            ]}
          />
        </div>
        {line.mode === 'monthly' && (
          <Field label="Montant mensuel">
            <MoneyInput value={line.amount} onChange={(v) => patch({ amount: v })} className="max-w-[180px]" />
          </Field>
        )}
        {line.mode === 'annual' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Montant annuel" hint="ex : Noël 400 €, vacances 1 500 €, véto 360 €">
              <MoneyInput value={line.annualAmount} onChange={(v) => patch({ annualAmount: v })} suffix="€/an" />
            </Field>
            <Field label="Part prise en charge par ce budget">
              <div className="flex items-center gap-2">
                <MoneyInput value={line.share} onChange={(v) => patch({ share: v })} max={100} suffix="%" className="w-24" />
                {[100, 50].map((p) => (
                  <button key={p} type="button" onClick={() => patch({ share: p })} className={`rounded-md border px-2 py-1 text-xs ${line.share === p ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'}`}>
                    {p} %
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}
        {line.mode === 'percent' && (
          <div className="space-y-3">
            <Field label="Pourcentage">
              <MoneyInput value={line.percent} onChange={(v) => patch({ percent: v })} max={1000} suffix="%" className="w-28" />
            </Field>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">De la somme de :</p>
              <div className="grid max-h-52 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-2">
                {candidates.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={line.refLineIds.includes(c.id)}
                      onChange={(e) => patch({ refLineIds: e.target.checked ? [...line.refLineIds, c.id] : line.refLineIds.filter((x) => x !== c.id) })}
                    />
                    <span className="flex-1 truncate">{c.label || '(sans libellé)'}</span>
                    <span className="text-slate-400 tabular-nums">{formatEuro(monthly(c.id), false)}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        <p className="mt-3 text-right text-sm text-slate-600">
          = <strong className="text-lg text-slate-900 tabular-nums">{formatEuro(value)}</strong> / mois · {formatEuro(value * 12, false)} / an
        </p>
      </div>
      {line.section === 'expense' && line.categoryId === 'epargne' && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Landmark className="h-3.5 w-3.5" /> Cette ligne est comptée comme de l’épargne. Reliez-la à un compte dans l’onglet Épargne pour suivre son évolution.
        </p>
      )}
    </Modal>
  );
}
