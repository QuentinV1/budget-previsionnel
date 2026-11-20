import { BudgetLine, BudgetState, Category, SAVINGS_CATEGORY_ID, Sheet } from '../types';

export type MonthlyMap = Map<string, number>;

/** Calcule le montant mensuel de chaque ligne (gère les modes annuel et pourcentage). */
export function computeMonthlyMap(lines: BudgetLine[]): MonthlyMap {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const cache: MonthlyMap = new Map();
  const visiting = new Set<string>();

  const resolve = (line: BudgetLine): number => {
    const cached = cache.get(line.id);
    if (cached !== undefined) return cached;
    if (visiting.has(line.id)) return 0; // référence circulaire
    visiting.add(line.id);
    let value = 0;
    if (line.mode === 'annual') {
      value = ((line.annualAmount || 0) / 12) * ((line.share ?? 100) / 100);
    } else if (line.mode === 'percent') {
      const base = line.refLineIds.reduce((sum, id) => {
        const ref = byId.get(id);
        return ref ? sum + resolve(ref) : sum;
      }, 0);
      value = (base * (line.percent || 0)) / 100;
    } else {
      value = line.amount || 0;
    }
    visiting.delete(line.id);
    const rounded = Math.round(value * 100) / 100;
    cache.set(line.id, rounded);
    return rounded;
  };

  for (const l of lines) resolve(l);
  return cache;
}

export const isSavingsLine = (l: BudgetLine) => l.section === 'expense' && l.categoryId === SAVINGS_CATEGORY_ID;
export const isTransfer = (l: BudgetLine) => l.section === 'debt' && l.group === 'virements';

export interface IncomingTransfer {
  line: BudgetLine;
  fromSheet: Sheet | undefined;
  amount: number;
}

export interface SheetSummary {
  sheet: Sheet;
  externalIncome: number;
  salaries: number;
  transfersIn: number;
  incoming: IncomingTransfer[];
  totalResources: number;
  /** Total dépenses (bloc Dépenses, épargne incluse), comme la colonne Excel */
  totalExpenses: number;
  solde: number;
  credits: number;
  transfersOut: number;
  totalDebts: number;
  soldeApresDettes: number;
  savings: number;
  /** Dépenses + crédits hors épargne et hors virements */
  spending: number;
}

export interface CategoryTotal {
  category: Category;
  amount: number;
  bySheet: Record<string, number>;
  lines: { line: BudgetLine; amount: number }[];
}

export interface HouseholdSummary {
  monthly: MonthlyMap;
  sheets: SheetSummary[];
  income: number;
  salaries: number;
  spending: number;
  savings: number;
  margin: number;
  credits: number;
  savingsRate: number;
  potentialSavingsRate: number;
  creditToSalary: number;
  byCategory: CategoryTotal[];
  transferControl: number;
  balanceControl: number;
}

export function computeSheetSummary(state: BudgetState, sheet: Sheet, monthly: MonthlyMap): SheetSummary {
  const own = state.lines.filter((l) => l.sheetId === sheet.id);
  const m = (l: BudgetLine) => monthly.get(l.id) ?? 0;
  const sum = (arr: BudgetLine[]) => arr.reduce((s, l) => s + m(l), 0);

  const resources = own.filter((l) => l.section === 'resource');
  const expenses = own.filter((l) => l.section === 'expense');
  const debts = own.filter((l) => l.section === 'debt');

  const incoming: IncomingTransfer[] = state.lines
    .filter((l) => isTransfer(l) && l.targetSheetId === sheet.id && l.sheetId !== sheet.id)
    .map((line) => ({ line, fromSheet: state.sheets.find((s) => s.id === line.sheetId), amount: m(line) }));

  const externalIncome = sum(resources);
  const transfersIn = incoming.reduce((s, t) => s + t.amount, 0);
  const totalResources = externalIncome + transfersIn;
  const totalExpenses = sum(expenses);
  const credits = sum(debts.filter((l) => !isTransfer(l)));
  const transfersOut = sum(debts.filter(isTransfer));
  const totalDebts = credits + transfersOut;
  const savings = sum(expenses.filter(isSavingsLine));
  const solde = totalResources - totalExpenses;

  return {
    sheet,
    externalIncome,
    salaries: sum(resources.filter((l) => l.group === 'salaires')),
    transfersIn,
    incoming,
    totalResources,
    totalExpenses,
    solde,
    credits,
    transfersOut,
    totalDebts,
    soldeApresDettes: solde - totalDebts,
    savings,
    spending: totalExpenses - savings + credits,
  };
}

/** Lignes qui comptent comme dépense (hors épargne, hors virements internes). */
export function isSpendingLine(l: BudgetLine): boolean {
  if (l.section === 'expense') return !isSavingsLine(l);
  if (l.section === 'debt') return !isTransfer(l);
  return false;
}

export function computeByCategory(state: BudgetState, monthly: MonthlyMap, sheetFilter?: string): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  const fallback = state.categories.find((c) => c.id === 'autres') ?? state.categories[0];
  for (const line of state.lines) {
    if (line.section === 'resource' || isTransfer(line)) continue;
    if (sheetFilter && line.sheetId !== sheetFilter) continue;
    const amount = monthly.get(line.id) ?? 0;
    const category = state.categories.find((c) => c.id === line.categoryId) ?? fallback;
    if (!category) continue;
    let entry = map.get(category.id);
    if (!entry) {
      entry = { category, amount: 0, bySheet: {}, lines: [] };
      map.set(category.id, entry);
    }
    entry.amount += amount;
    entry.bySheet[line.sheetId] = (entry.bySheet[line.sheetId] ?? 0) + amount;
    entry.lines.push({ line, amount });
  }
  for (const e of map.values()) e.lines.sort((a, b) => b.amount - a.amount);
  return [...map.values()].filter((e) => e.amount > 0.004).sort((a, b) => b.amount - a.amount);
}

export interface TagTotal {
  tag: string;
  amount: number;
  lines: { line: BudgetLine; amount: number }[];
}

export function computeByTag(state: BudgetState, monthly: MonthlyMap, sheetFilter?: string): TagTotal[] {
  const map = new Map<string, TagTotal>();
  for (const line of state.lines) {
    if (!isSpendingLine(line)) continue;
    if (sheetFilter && line.sheetId !== sheetFilter) continue;
    const tags = line.tags && line.tags.length > 0 ? line.tags : ['Sans tag'];
    const amount = monthly.get(line.id) ?? 0;
    if (amount <= 0.004) continue;
    for (const tag of tags) {
      let entry = map.get(tag);
      if (!entry) {
        entry = { tag, amount: 0, lines: [] };
        map.set(tag, entry);
      }
      entry.amount += amount;
      entry.lines.push({ line, amount });
    }
  }
  for (const e of map.values()) e.lines.sort((a, b) => b.amount - a.amount);
  return [...map.values()].sort((a, b) => {
    if (a.tag === 'Sans tag') return 1;
    if (b.tag === 'Sans tag') return -1;
    return b.amount - a.amount;
  });
}

export function computeHousehold(state: BudgetState): HouseholdSummary {
  const monthly = computeMonthlyMap(state.lines);
  const sheets = state.sheets.map((s) => computeSheetSummary(state, s, monthly));
  const income = sheets.reduce((s, x) => s + x.externalIncome, 0);
  const salaries = sheets.reduce((s, x) => s + x.salaries, 0);
  const spending = sheets.reduce((s, x) => s + x.spending, 0);
  const savings = sheets.reduce((s, x) => s + x.savings, 0);
  const credits = sheets.reduce((s, x) => s + x.credits, 0);
  const margin = income - spending - savings;

  // Mensualités de crédit : lignes "crédits" + lignes liées à un prêt (ex : prêt immo saisi en logement)
  const loanLineIds = new Set(state.loans.map((l) => l.linkedLineId).filter(Boolean));
  const creditLines = state.lines.filter(
    (l) => (l.section === 'debt' && l.group === 'credits') || loanLineIds.has(l.id)
  );
  const allCredits = creditLines.reduce((s, l) => s + (monthly.get(l.id) ?? 0), 0);

  const transfersOut = sheets.reduce((s, x) => s + x.transfersOut, 0);
  const transfersIn = sheets.reduce((s, x) => s + x.transfersIn, 0);

  return {
    monthly,
    sheets,
    income,
    salaries,
    spending,
    savings,
    margin,
    credits: allCredits || credits,
    savingsRate: income > 0 ? savings / income : 0,
    potentialSavingsRate: income > 0 ? (income - spending) / income : 0,
    creditToSalary: salaries > 0 ? (allCredits || credits) / salaries : 0,
    byCategory: computeByCategory(state, monthly),
    transferControl: Math.round((transfersOut - transfersIn) * 100) / 100,
    balanceControl: Math.round((margin - sheets.reduce((s, x) => s + x.soldeApresDettes, 0)) * 100) / 100,
  };
}
