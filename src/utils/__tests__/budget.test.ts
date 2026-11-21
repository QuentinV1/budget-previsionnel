import { describe, expect, it } from 'vitest';
import { createDefaultState } from '../../data/defaultData';
import { cleanForFirestore, formatSyncError } from '../../firebase';
import { mergeBudgetStates } from '../../services/householdService';
import { BudgetLine } from '../../types';
import { parseBankCsv } from '../bankCsv';
import { computeByCategory, computeByTag, computeHousehold, computeMonthlyMap } from '../calc';
import { computeProrata, computeReserve, project } from '../finance';
import { isValidState, parseImported } from '../storage';

describe('computeMonthlyMap', () => {
  it('handles monthly, annual with share, percent, and circular references', () => {
    const lines: BudgetLine[] = [
      {
        id: 'a',
        sheetId: 's1',
        section: 'expense',
        group: 'courant',
        label: 'Train',
        comment: '',
        mode: 'monthly',
        amount: 400,
        annualAmount: 0,
        share: 100,
        percent: 100,
        refLineIds: [],
        categoryId: 'mobilite',
      },
      {
        id: 'b',
        sheetId: 's1',
        section: 'expense',
        group: 'courant',
        label: 'Noel',
        comment: '',
        mode: 'annual',
        amount: 0,
        annualAmount: 600,
        share: 50,
        percent: 100,
        refLineIds: [],
        categoryId: 'projets',
      },
      {
        id: 'c',
        sheetId: 's1',
        section: 'resource',
        group: 'remboursements',
        label: 'Rbst Train',
        comment: '',
        mode: 'percent',
        amount: 0,
        annualAmount: 0,
        share: 100,
        percent: 75,
        refLineIds: ['a'],
        categoryId: '',
      },
      {
        id: 'circ1',
        sheetId: 's1',
        section: 'expense',
        group: 'courant',
        label: 'Circ1',
        comment: '',
        mode: 'percent',
        amount: 0,
        annualAmount: 0,
        share: 100,
        percent: 50,
        refLineIds: ['circ2'],
        categoryId: 'autres',
      },
      {
        id: 'circ2',
        sheetId: 's1',
        section: 'expense',
        group: 'courant',
        label: 'Circ2',
        comment: '',
        mode: 'percent',
        amount: 0,
        annualAmount: 0,
        share: 100,
        percent: 50,
        refLineIds: ['circ1'],
        categoryId: 'autres',
      },
    ];

    const map = computeMonthlyMap(lines);
    expect(map.get('a')).toBe(400);
    expect(map.get('b')).toBe(25);
    expect(map.get('c')).toBe(300);
    expect(map.get('circ1')).toBe(0);
  });
});

describe('computeHousehold, computeByCategory & computeByTag', () => {
  it('computes balanced transfers and household totals on default state', () => {
    const state = createDefaultState();
    const summary = computeHousehold(state);

    expect(summary.transferControl).toBe(0);
    expect(summary.income).toBeGreaterThan(0);
    expect(summary.spending).toBeGreaterThan(0);
    expect(summary.savings).toBeGreaterThan(0);
    expect(Math.abs(summary.balanceControl)).toBeLessThan(0.05);
  });

  it('groups expenses by tag including Abonnement', () => {
    const state = createDefaultState();
    const summary = computeHousehold(state);
    const byTag = computeByTag(state, summary.monthly);
    const abo = byTag.find((t) => t.tag === 'Abonnement');

    expect(abo).toBeDefined();
    expect(abo!.lines.some((x) => x.line.label === 'Netflix')).toBe(true);
    expect(abo!.amount).toBeGreaterThan(0);

    const byCat = computeByCategory(state, summary.monthly);
    expect(byCat.length).toBeGreaterThan(0);
  });
});

describe('finance utilities', () => {
  it('computes prorata contributions proportional to salaries', () => {
    const state = createDefaultState();
    const summary = computeHousehold(state);
    const pr = computeProrata(state, summary, 'commun');

    expect(pr.rows.length).toBe(2);
    const totalCurrent = pr.rows.reduce((s, r) => s + r.current, 0);
    const totalProrata = pr.rows.reduce((s, r) => s + r.prorata, 0);
    expect(Math.abs(totalCurrent - totalProrata)).toBeLessThan(0.05);
  });

  it('computes reserve and multi-year wealth projection', () => {
    const state = createDefaultState();
    const summary = computeHousehold(state);
    const res = computeReserve(state, summary);

    expect(res.target).toBeGreaterThan(0);
    expect(res.livrets).toBeGreaterThan(0);
    const pts = project(state, res, summary.savings, state.assumptions.rateCentral, 10);
    expect(pts).toHaveLength(11);
    expect(pts[10].invested).toBeGreaterThan(pts[0].invested);
  });
});

describe('storage & bankCsv utilities', () => {
  it('validates and normalizes imported JSON state', () => {
    const state = createDefaultState();
    expect(isValidState(state)).toBe(true);
    expect(isValidState({ version: 1 })).toBe(false);

    const parsed = parseImported(JSON.stringify(state));
    expect(parsed).not.toBeNull();
    expect(parsed?.monthlyRecords).toEqual([]);
    expect(parseImported('invalid-json')).toBeNull();
  });

  it('parses French bank CSV and auto-categorizes known labels', () => {
    const state = createDefaultState();
    const csv = [
      'Date;Libellé;Montant',
      '05/11/2026;NETFLIX.COM;-13,49',
      '06/11/2026;CARREFOUR MARKET;-82,30',
      '01/11/2026;VIREMENT SALAIRE;3120,00',
    ].join('\n');

    const txs = parseBankCsv(csv, state.lines, state.categories);
    expect(txs).toHaveLength(3);
    expect(txs[0]).toMatchObject({ date: '2026-11-05', type: 'expense', amount: 13.49, categoryId: 'loisirs' });
    expect(txs[1]).toMatchObject({ date: '2026-11-06', type: 'expense', amount: 82.3, categoryId: 'alimentation' });
    expect(txs[2]).toMatchObject({ date: '2026-11-01', type: 'income', amount: 3120 });
  });

  it('merges local non-demo items into server state on new device login and formats sync errors', () => {
    const serverState = createDefaultState();
    const localState = createDefaultState();
    localState.lines.push({
      id: 'custom-line-99',
      sheetId: 'commun',
      section: 'expense',
      group: 'courant',
      label: 'Dépense locale ajoutée hors-ligne',
      comment: '',
      mode: 'monthly',
      amount: 75,
      annualAmount: 0,
      share: 100,
      percent: 100,
      refLineIds: [],
      categoryId: 'autres',
    });

    const { merged, hasLocalAdditions } = mergeBudgetStates(serverState, localState);
    expect(hasLocalAdditions).toBe(true);
    expect(merged.lines.some((l) => l.id === 'custom-line-99')).toBe(true);

    const cleaned = cleanForFirestore({ a: 1, b: undefined });
    expect(cleaned).toEqual({ a: 1, b: null });

    expect(formatSyncError({ code: 'permission-denied' })).toBe(
      'Accès Firestore refusé (vérifiez que votre e-mail est bien vérifié et autorisé).'
    );
  });
});
