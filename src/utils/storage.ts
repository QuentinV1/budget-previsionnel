import { createDefaultState } from '../data/defaultData';
import { BudgetState, EXPENSE_GROUPS, RESOURCE_GROUPS, DEBT_GROUPS } from '../types';
import { computeHousehold } from './calc';

const STORAGE_KEY = 'budget-previsionnel-foyer:v2';

export function isValidState(data: unknown): data is BudgetState {
  if (!data || typeof data !== 'object') return false;
  const c = data as Partial<BudgetState>;
  return (
    c.version === 2 &&
    Array.isArray(c.sheets) &&
    Array.isArray(c.lines) &&
    Array.isArray(c.categories) &&
    Array.isArray(c.accounts) &&
    Array.isArray(c.loans) &&
    Array.isArray(c.levers) &&
    typeof c.assumptions === 'object'
  );
}

export function normalizeState(s: BudgetState): BudgetState {
  return {
    ...createDefaultState(),
    ...s,
    goals: s.goals ?? [],
    dismissedTips: s.dismissedTips ?? [],
    monthlyRecords: s.monthlyRecords ?? [],
  };
}

export function hasLocalState(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearLocalState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadState(): BudgetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw) as unknown;
    return isValidState(parsed) ? normalizeState(parsed) : createDefaultState();
  } catch {
    return createDefaultState();
  }
}

export function saveState(state: BudgetState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
  } catch {
    /* quota */
  }
}

export function parseImported(text: string): BudgetState | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isValidState(parsed) ? normalizeState(parsed) : null;
  } catch {
    return null;
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportJson(state: BudgetState) {
  download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), `budget-foyer-${stamp()}.json`);
}

const cell = (v: string | number) => {
  const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Export « Détail consolidé » : une ligne par poste, comme l'onglet Excel. */
export function exportCsv(state: BudgetState) {
  const summary = computeHousehold(state);
  const groupLabel = (g: string) =>
    [...RESOURCE_GROUPS, ...EXPENSE_GROUPS, ...DEBT_GROUPS].find((x) => x.id === g)?.label ?? g;
  const rows: (string | number)[][] = [['Budget', 'Bloc', 'Groupe', 'Poste', 'Nature', 'Type', 'Tags', 'Mensuel (€)', 'Annuel (€)', 'Commentaire']];
  for (const l of state.lines) {
    const sheet = state.sheets.find((s) => s.id === l.sheetId)?.name ?? '';
    const m = summary.monthly.get(l.id) ?? 0;
    const nature =
      l.section === 'resource' ? 'Revenu' : l.group === 'virements' ? 'Transfert sortant' : l.categoryId === 'epargne' ? 'Épargne' : 'Dépense';
    const type =
      l.section === 'resource'
        ? 'Ressources'
        : l.group === 'virements'
          ? 'Virements internes'
          : state.categories.find((c) => c.id === l.categoryId)?.label ?? '';
    const bloc = l.section === 'resource' ? 'Ressources' : l.section === 'expense' ? 'Dépenses' : 'Dettes';
    const tags = (l.tags ?? []).join(', ');
    rows.push([sheet, bloc, groupLabel(l.group), l.label, nature, type, tags, m, m * 12, l.comment]);
  }
  rows.push([]);
  rows.push(['Budget', 'Ressources', 'Dépenses', 'Solde', 'Dettes', 'Solde après dettes']);
  for (const s of summary.sheets) rows.push([s.sheet.name, s.totalResources, s.totalExpenses, s.solde, s.totalDebts, s.soldeApresDettes]);
  const csv = '\uFEFF' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `budget-foyer-${stamp()}.csv`);
}
