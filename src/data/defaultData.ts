import { BudgetLine, BudgetState, Category, LineGroup, Section } from '../types';

/**
 * Jeu de données de démonstration générique (aucune donnée personnelle).
 */

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

type LineInit = Partial<BudgetLine> & { id: string; label: string };

function mk(sheetId: string, section: Section, group: LineGroup, init: LineInit): BudgetLine {
  return {
    sheetId,
    section,
    group,
    comment: '',
    mode: 'monthly',
    amount: 0,
    annualAmount: 0,
    share: 100,
    percent: 100,
    refLineIds: [],
    categoryId: section === 'resource' ? '' : 'autres',
    ...init,
  };
}

function buildLines(): BudgetLine[] {
  const C = 'commun';
  const P1 = 'membre1';
  const P2 = 'membre2';
  return [
    // ───────── Budget - Commun ─────────
    mk(C, 'expense', 'courant', { id: 'c-alim', label: 'Alimentation et hygiène', amount: 500, categoryId: 'alimentation' }),
    mk(C, 'expense', 'courant', { id: 'c-telecom', label: 'Internet & Mobile', amount: 40, categoryId: 'telecoms', tags: ['Abonnement', 'Fixe'] }),
    mk(C, 'expense', 'courant', { id: 'c-vacances', label: 'Vacances', mode: 'annual', annualAmount: 1200, share: 100, amount: 100, categoryId: 'projets' }),
    mk(C, 'expense', 'logement', { id: 'c-loyer', label: 'Loyer / Crédit logement', amount: 900, categoryId: 'logement', tags: ['Fixe', 'Essentiel'] }),
    mk(C, 'expense', 'logement', { id: 'c-energie', label: 'Électricité & Eau', amount: 100, categoryId: 'logement', tags: ['Provision', 'Essentiel'] }),
    mk(C, 'expense', 'assurances', { id: 'c-mrh', label: 'Assurance habitation', amount: 30, categoryId: 'logement', tags: ['Fixe'] }),

    // ───────── Budget - Alex ─────────
    mk(P1, 'resource', 'salaires', { id: 'm1-salaire', label: 'Salaire Alex', amount: 2500 }),
    mk(P1, 'expense', 'courant', { id: 'm1-alim', label: 'Repas & divers', amount: 100, categoryId: 'alimentation' }),
    mk(P1, 'expense', 'courant', { id: 'm1-transport', label: 'Transport', amount: 80, categoryId: 'mobilite' }),
    mk(P1, 'expense', 'courant', { id: 'm1-netflix', label: 'Netflix', amount: 13.49, categoryId: 'loisirs', tags: ['Abonnement', 'Plaisir'] }),
    mk(P1, 'expense', 'placements', { id: 'm1-epargne', label: 'Épargne Alex', amount: 300, categoryId: 'epargne' }),
    mk(P1, 'debt', 'virements', { id: 'm1-vir-commun', label: 'Compte commun', amount: 1000, targetSheetId: C, categoryId: '' }),

    // ───────── Budget - Sam ─────────
    mk(P2, 'resource', 'salaires', { id: 'm2-salaire', label: 'Salaire Sam', amount: 2000 }),
    mk(P2, 'expense', 'courant', { id: 'm2-transport', label: 'Transport', amount: 60, categoryId: 'mobilite' }),
    mk(P2, 'expense', 'courant', { id: 'm2-loisirs', label: 'Loisirs', amount: 120, categoryId: 'loisirs' }),
    mk(P2, 'expense', 'placements', { id: 'm2-epargne', label: 'Épargne Sam', amount: 250, categoryId: 'epargne' }),
    mk(P2, 'debt', 'virements', { id: 'm2-vir-commun', label: 'Compte commun', amount: 670, targetSheetId: C, categoryId: '' }),
  ];
}

export function createDefaultState(): BudgetState {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    householdName: 'Foyer Démo',
    sheets: [
      { id: 'membre1', name: 'Alex', kind: 'person', color: 'indigo' },
      { id: 'membre2', name: 'Sam', kind: 'person', color: 'rose' },
      { id: 'commun', name: 'Commun', kind: 'common', color: 'slate' },
    ],
    lines: buildLines(),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    accounts: [
      {
        id: 'acc-1-livret',
        ownerId: 'membre1',
        name: 'Livret A',
        type: 'livret',
        capitalise: false,
        monthlyIncome: 0,
        note: 'Épargne de précaution.',
        linkedLineIds: ['m1-epargne'],
        history: [{ date: '2026-10-01', balance: 5000 }],
      },
      {
        id: 'acc-1-pea',
        ownerId: 'membre1',
        name: 'PEA',
        type: 'placement',
        capitalise: true,
        monthlyIncome: 0,
        note: 'Investissement long terme.',
        linkedLineIds: [],
        history: [{ date: '2026-10-01', balance: 4000 }],
      },
      {
        id: 'acc-2-livret',
        ownerId: 'membre2',
        name: 'Livret A',
        type: 'livret',
        capitalise: false,
        monthlyIncome: 0,
        note: 'Épargne disponible.',
        linkedLineIds: ['m2-epargne'],
        history: [{ date: '2026-10-01', balance: 4500 }],
      },
    ],
    goals: [
      {
        id: 'goal-vacances',
        name: 'Vacances',
        target: 1200,
        deadline: '2027-07',
        accountIds: [],
        color: '#ec4899',
      },
    ],
    loans: [],
    levers: [
      {
        id: 'lev-abos',
        label: 'Abonnements de loisirs',
        lineIds: ['m1-netflix', 'c-telecom'],
        reduction: 15,
        action: 'Alterner les abonnements et optimiser les forfaits.',
      },
    ],
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
