import { BudgetState, Lever, Loan, SavingsAccount } from '../types';
import { HouseholdSummary, MonthlyMap } from './calc';

export const TODAY = () => new Date();

export function sortedHistory(acc: SavingsAccount) {
  return [...acc.history].sort((a, b) => a.date.localeCompare(b.date));
}

export function accountBalance(acc: SavingsAccount): number {
  const h = sortedHistory(acc);
  return h.length ? h[h.length - 1].balance : 0;
}

export function accountLastDate(acc: SavingsAccount): string {
  const h = sortedHistory(acc);
  return h.length ? h[h.length - 1].date : '';
}

export function accountContribution(acc: SavingsAccount, monthly: MonthlyMap): number {
  return acc.linkedLineIds.reduce((s, id) => s + (monthly.get(id) ?? 0), 0);
}

export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + (to.getDate() - from.getDate()) / 30;
}

/** Solde attendu aujourd'hui = dernier relevé + versements budgétés depuis. */
export function expectedBalanceNow(acc: SavingsAccount, monthly: MonthlyMap): number {
  const last = accountLastDate(acc);
  if (!last) return 0;
  const months = Math.max(0, Math.floor(monthsBetween(new Date(last), TODAY())));
  return accountBalance(acc) + months * accountContribution(acc, monthly);
}

export interface ReserveInfo {
  target: number;
  livrets: number;
  gap: number;
  monthsCovered: number;
  perPerson: { sheetId: string; name: string; livrets: number; monthlyNeed: number; monthsCovered: number }[];
}

export function computeReserve(state: BudgetState, summary: HouseholdSummary): ReserveInfo {
  const months = state.assumptions.reserveMonths;
  const livretAccounts = state.accounts.filter((a) => a.type === 'livret');
  const livrets = livretAccounts.reduce((s, a) => s + accountBalance(a), 0);
  const target = summary.spending * months;
  const perPerson = summary.sheets
    .filter((s) => s.sheet.kind === 'person')
    .map((s) => {
      const own = livretAccounts.filter((a) => a.ownerId === s.sheet.id).reduce((x, a) => x + accountBalance(a), 0);
      // Besoin mensuel individuel : ses dépenses + sa contribution aux budgets communs
      const need = s.spending + s.transfersOut;
      return {
        sheetId: s.sheet.id,
        name: s.sheet.name,
        livrets: own,
        monthlyNeed: need,
        monthsCovered: need > 0 ? own / need : 0,
      };
    });
  return {
    target,
    livrets,
    gap: Math.max(0, target - livrets),
    monthsCovered: summary.spending > 0 ? livrets / summary.spending : 0,
    perPerson,
  };
}

export function leverCurrent(lever: Lever, monthly: MonthlyMap): number {
  return lever.lineIds.reduce((s, id) => s + (monthly.get(id) ?? 0), 0);
}

export function leverGain(lever: Lever, monthly: MonthlyMap): number {
  const current = leverCurrent(lever, monthly);
  return Math.min(current, Math.max(0, lever.reduction));
}

export interface Scenario {
  id: 'actuelle' | 'progressive' | 'optimisee';
  label: string;
  monthly: number;
  requiredGains: number;
  keptMargin: number;
  color: string;
}

export function computeScenarios(state: BudgetState, summary: HouseholdSummary): Scenario[] {
  const gains = state.levers.reduce((s, l) => s + leverGain(l, summary.monthly), 0);
  const capacity = summary.income - summary.spending;
  const base = summary.savings;
  const prog = base + state.assumptions.progressiveExtra;
  const opt = prog + gains;
  return [
    { id: 'actuelle', label: 'Actuelle', monthly: base, requiredGains: 0, keptMargin: capacity - base, color: '#64748b' },
    { id: 'progressive', label: 'Progressive', monthly: prog, requiredGains: 0, keptMargin: capacity - prog, color: '#6366f1' },
    { id: 'optimisee', label: 'Optimisée', monthly: opt, requiredGains: gains, keptMargin: capacity + gains - opt, color: '#10b981' },
  ];
}

function fv(rate: number, nper: number, pmt: number): number {
  if (nper <= 0) return 0;
  if (rate === 0) return pmt * nper;
  return pmt * ((Math.pow(1 + rate, nper) - 1) / rate);
}

export interface ProjectionPoint {
  year: number;
  invested: number; // placements (capitalisés + non capitalisés + versements)
  livrets: number;
  contributed: number; // somme versée hors rendement
}

/**
 * Projection fidèle au fichier Excel :
 * - les versements comblent d'abord l'écart à la réserve de sécurité (livrets, sans intérêts),
 * - puis sont placés au taux annuel choisi (taux mensuel équivalent, versements en fin de mois),
 * - placements "capitalisés" (PEI, actions) croissent au taux ; les autres (Bricks) restent constants.
 */
export function project(
  state: BudgetState,
  reserve: ReserveInfo,
  monthlySaving: number,
  annualRatePct: number,
  years: number
): ProjectionPoint[] {
  const placements = state.accounts.filter((a) => a.type === 'placement');
  const capitalised = placements.filter((a) => a.capitalise).reduce((s, a) => s + accountBalance(a), 0);
  const fixed = placements.filter((a) => !a.capitalise).reduce((s, a) => s + accountBalance(a), 0);
  const r = annualRatePct / 100;
  const rm = Math.pow(1 + r, 1 / 12) - 1;
  const delay = monthlySaving > 0 ? Math.ceil(reserve.gap / monthlySaving) : 0;
  const points: ProjectionPoint[] = [];
  for (let y = 0; y <= years; y++) {
    const investMonths = Math.max(0, y * 12 - delay);
    const invested = fixed + capitalised * Math.pow(1 + r, y) + fv(rm, investMonths, monthlySaving);
    const livrets = reserve.livrets + Math.min(reserve.gap, y * 12 * monthlySaving);
    points.push({
      year: y,
      invested,
      livrets,
      contributed: fixed + capitalised + reserve.livrets + y * 12 * monthlySaving,
    });
  }
  return points;
}

export interface LoanInfo {
  monthly: number;
  monthsLeft: number | null;
  progress: number | null;
  amortized: number | null;
  remainingInterest: number | null;
  endLabel: string;
  remainingNow: number;
}

export function computeLoan(loan: Loan, monthly: MonthlyMap): LoanInfo {
  const pay = loan.linkedLineId ? monthly.get(loan.linkedLineId) ?? 0 : 0;
  const end = loan.endDate ? new Date(loan.endDate) : null;
  const monthsLeft = end ? Math.max(0, Math.round(monthsBetween(TODAY(), end))) : null;
  let remainingNow = loan.remaining;
  let remainingInterest: number | null = null;
  if (loan.rate != null && loan.rate > 0) {
    const rm = loan.rate / 100 / 12;
    // capital amorti depuis la date de la situation déclarée
    const elapsed = loan.asOf ? Math.max(0, Math.floor(monthsBetween(new Date(loan.asOf), TODAY()))) : 0;
    let cap = loan.remaining;
    const n = end && loan.asOf ? Math.max(1, Math.round(monthsBetween(new Date(loan.asOf), end))) : null;
    const theoretical = n ? (cap * rm) / (1 - Math.pow(1 + rm, -n)) : pay;
    for (let i = 0; i < elapsed && cap > 0; i++) cap -= theoretical - cap * rm;
    remainingNow = Math.max(0, cap);
    if (monthsLeft != null) remainingInterest = Math.max(0, theoretical * monthsLeft - remainingNow);
  } else if (loan.asOf && end) {
    // Sans taux : amortissement linéaire approximatif
    const n = Math.max(1, monthsBetween(new Date(loan.asOf), end));
    const elapsed = Math.max(0, Math.floor(monthsBetween(new Date(loan.asOf), TODAY())));
    remainingNow = Math.max(0, loan.remaining * (1 - Math.min(1, elapsed / n)));
  }
  const amortized = loan.initial ? loan.initial - remainingNow : null;
  return {
    monthly: pay,
    monthsLeft,
    progress: loan.initial ? amortized! / loan.initial : null,
    amortized,
    remainingInterest,
    endLabel: end ? end.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : 'Non renseignée',
    remainingNow,
  };
}

/** Répartition au prorata des salaires des virements vers une feuille commune. */
export function computeProrata(state: BudgetState, summary: HouseholdSummary, targetSheetId: string) {
  const persons = summary.sheets.filter((s) => s.sheet.kind === 'person');
  const totalSalary = persons.reduce((s, p) => s + p.salaries, 0);
  const rows = persons.map((p) => {
    const lines = state.lines.filter((l) => l.sheetId === p.sheet.id && l.group === 'virements' && l.targetSheetId === targetSheetId);
    const current = lines.reduce((s, l) => s + (summary.monthly.get(l.id) ?? 0), 0);
    return { sheet: p.sheet, salary: p.salaries, current, lineIds: lines.map((l) => l.id), prorata: 0, delta: 0 };
  });
  const totalCurrent = rows.reduce((s, r) => s + r.current, 0);
  for (const r of rows) {
    r.prorata = totalSalary > 0 ? (totalCurrent * r.salary) / totalSalary : 0;
    r.delta = r.prorata - r.current;
  }
  return { rows, totalCurrent, totalSalary };
}
