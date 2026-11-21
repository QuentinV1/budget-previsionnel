import { BudgetState, Category } from '../types';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'logement', label: 'Logement', color: '#0ea5e9', bucket: 'besoin' },
  { id: 'mobilite', label: 'Mobilité', color: '#f59e0b', bucket: 'besoin' },
  { id: 'alimentation', label: 'Alimentation et hygiène', color: '#10b981', bucket: 'besoin' },
  { id: 'loisirs', label: 'Loisirs et abonnements', color: '#8b5cf6', bucket: 'envie' },
  { id: 'projets', label: 'Projets annuels', color: '#ec4899', bucket: 'envie' },
  { id: 'animaux', label: 'Animaux', color: '#f97316', bucket: 'besoin' },
  { id: 'banque', label: 'Banque et protection', color: '#64748b', bucket: 'besoin' },
  { id: 'telecoms', label: 'Télécoms', color: '#6366f1', bucket: 'besoin' },
  { id: 'sante', label: 'Santé', color: '#14b8a6', bucket: 'besoin' },
  { id: 'impots', label: 'Impôts et taxes', color: '#ef4444', bucket: 'besoin' },
  { id: 'autres', label: 'Autres', color: '#a8a29e', bucket: 'envie' },
  { id: 'epargne', label: 'Épargne', color: '#22c55e', bucket: 'epargne' },
];

export function createDefaultState(): BudgetState {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    householdName: 'Mon Foyer',
    sheets: [
      { id: 'commun', name: 'Commun', kind: 'common', color: 'slate' },
    ],
    lines: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    accounts: [],
    goals: [],
    loans: [],
    levers: [],
    assumptions: {
      reserveMonths: 3,
      rateCentral: 3,
      rateLow: 0,
      rateHigh: 5,
      inflation: 2,
      progressiveExtra: 200,
      horizonYears: 30,
    },
    dismissedTips: [],
  };
}
