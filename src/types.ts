/** Une "feuille" de budget, comme un onglet du fichier Excel : Budget - Quentin, Budget - Commun… */
export type SheetKind = 'person' | 'common';

export type SheetColor = 'indigo' | 'rose' | 'emerald' | 'amber' | 'sky' | 'violet' | 'slate' | 'teal';

export interface Sheet {
  id: string;
  name: string;
  kind: SheetKind;
  color: SheetColor;
}

/** Les grands blocs d'une feuille, comme dans le modèle Excel (Ressources / Dépenses / Dettes). */
export type Section = 'resource' | 'expense' | 'debt';

export type ResourceGroup = 'salaires' | 'remboursements' | 'patrimoine' | 'pensions' | 'allocations' | 'autres_ressources';
export type ExpenseGroup =
  | 'courant'
  | 'sante'
  | 'logement'
  | 'assurances'
  | 'achats'
  | 'impots'
  | 'placements'
  | 'autres_depenses';
export type DebtGroup = 'credits' | 'virements';
export type LineGroup = ResourceGroup | ExpenseGroup | DebtGroup;

/**
 * Mode de saisie du montant :
 * - monthly : montant mensuel direct
 * - annual  : montant annuel ÷ 12 × part (ex : Noël 400 €/an partagé à 50 %)
 * - percent : pourcentage de la somme d'autres lignes (ex : remboursement 75 % du transport)
 */
export type AmountMode = 'monthly' | 'annual' | 'percent';

export interface BudgetLine {
  id: string;
  sheetId: string;
  section: Section;
  group: LineGroup;
  label: string;
  comment: string;
  mode: AmountMode;
  /** Mensuel (mode monthly) */
  amount: number;
  /** Annuel (mode annual) */
  annualAmount: number;
  /** Part prise en charge en % (mode annual), 100 par défaut */
  share: number;
  /** % appliqué (mode percent) */
  percent: number;
  /** Lignes de référence (mode percent) */
  refLineIds: string[];
  /** Type de dépense pour la synthèse (dépenses & crédits) */
  categoryId: string;
  /** Feuille destinataire si virement interne (groupe "virements") */
  targetSheetId?: string;
  /** Tags fins pour affiner le suivi (ex: Abonnement, Fixe, Provision, Plaisir…) */
  tags?: string[];
}

export type Bucket = 'besoin' | 'envie' | 'epargne';

export interface Category {
  id: string;
  label: string;
  color: string;
  /** Classement 50 / 30 / 20 */
  bucket: Bucket;
}

export type AccountType = 'livret' | 'placement';

export interface BalanceSnapshot {
  date: string; // YYYY-MM-DD
  balance: number;
}

export interface SavingsAccount {
  id: string;
  ownerId: string; // sheetId
  name: string;
  type: AccountType;
  /** Si faux : capital constant dans les projections (ex : Bricks qui verse un revenu) */
  capitalise: boolean;
  monthlyIncome: number;
  note: string;
  /** Lignes "Placements" du budget qui alimentent ce compte */
  linkedLineIds: string[];
  history: BalanceSnapshot[];
}

export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  deadline: string; // YYYY-MM ou ''
  accountIds: string[];
  color: string;
}

export interface Loan {
  id: string;
  name: string;
  ownerId: string;
  initial: number | null;
  remaining: number;
  /** Taux annuel en % (ex : 3.54) */
  rate: number | null;
  endDate: string; // YYYY-MM-DD ou ''
  linkedLineId: string;
  note: string;
  /** Date de la situation déclarée du restant dû */
  asOf: string;
}

export interface Lever {
  id: string;
  label: string;
  lineIds: string[];
  reduction: number;
  action: string;
}

export interface Assumptions {
  reserveMonths: number;
  rateCentral: number; // %
  rateLow: number;
  rateHigh: number;
  inflation: number;
  progressiveExtra: number;
  horizonYears: number;
}

export interface BudgetState {
  version: 2;
  updatedAt: string;
  householdName: string;
  sheets: Sheet[];
  lines: BudgetLine[];
  categories: Category[];
  accounts: SavingsAccount[];
  goals: SavingsGoal[];
  loans: Loan[];
  levers: Lever[];
  assumptions: Assumptions;
  dismissedTips: string[];
  monthlyRecords?: MonthlyRecord[];
}

export interface BankTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  amount: number; // montant positif
  type: 'expense' | 'income';
  categoryId: string;
}

export interface MonthlyRecord {
  month: string; // YYYY-MM
  incomeActual: number;
  actualsByCategory: Record<string, number>;
  note?: string;
  transactions?: BankTransaction[];
}

export const PRESET_TAGS = ['Abonnement', 'Fixe', 'Variable', 'Provision', 'Essentiel', 'Plaisir'] as const;

export const RESOURCE_GROUPS: { id: ResourceGroup; label: string }[] = [
  { id: 'salaires', label: 'Salaires' },
  { id: 'remboursements', label: 'Remboursements & notes de frais' },
  { id: 'patrimoine', label: 'Revenus du patrimoine' },
  { id: 'pensions', label: 'Pensions' },
  { id: 'allocations', label: 'Allocations' },
  { id: 'autres_ressources', label: 'Autres ressources' },
];

export const EXPENSE_GROUPS: { id: ExpenseGroup; label: string; defaultCategory: string }[] = [
  { id: 'courant', label: 'Vie courante', defaultCategory: 'alimentation' },
  { id: 'sante', label: 'Santé', defaultCategory: 'sante' },
  { id: 'logement', label: 'Logement', defaultCategory: 'logement' },
  { id: 'assurances', label: 'Assurances', defaultCategory: 'banque' },
  { id: 'achats', label: 'Achats importants', defaultCategory: 'projets' },
  { id: 'impots', label: 'Impôts et taxes', defaultCategory: 'impots' },
  { id: 'placements', label: 'Placements / épargne', defaultCategory: 'epargne' },
  { id: 'autres_depenses', label: 'Autres dépenses', defaultCategory: 'autres' },
];

export const DEBT_GROUPS: { id: DebtGroup; label: string }[] = [
  { id: 'credits', label: 'Crédits' },
  { id: 'virements', label: 'Virements vers un autre budget' },
];

export const SAVINGS_CATEGORY_ID = 'epargne';

export const SHEET_COLORS: Record<SheetColor, { hex: string; soft: string; text: string; ring: string; bg: string }> = {
  indigo: { hex: '#6366f1', soft: 'bg-indigo-50', text: 'text-indigo-700', ring: 'ring-indigo-200', bg: 'bg-indigo-500' },
  rose: { hex: '#f43f5e', soft: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200', bg: 'bg-rose-500' },
  emerald: { hex: '#10b981', soft: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', bg: 'bg-emerald-500' },
  amber: { hex: '#f59e0b', soft: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200', bg: 'bg-amber-500' },
  sky: { hex: '#0ea5e9', soft: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-200', bg: 'bg-sky-500' },
  violet: { hex: '#8b5cf6', soft: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200', bg: 'bg-violet-500' },
  slate: { hex: '#475569', soft: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-300', bg: 'bg-slate-600' },
  teal: { hex: '#14b8a6', soft: 'bg-teal-50', text: 'text-teal-700', ring: 'ring-teal-200', bg: 'bg-teal-500' },
};
