import { BankTransaction, BudgetLine, Category } from '../types';
import { createId, parseNumber } from './format';

const CATEGORY_KEYWORDS: { categoryId: string; keywords: string[] }[] = [
  { categoryId: 'alimentation', keywords: ['carrefour', 'leclerc', 'auchan', 'lidl', 'aldi', 'intermarche', 'monoprix', 'franprix', 'hellofresh', 'picard', 'boulangerie', 'super u', 'courses'] },
  { categoryId: 'logement', keywords: ['edf', 'engie', 'electricite', 'eau', 'veolia', 'suez', 'loyer', 'foncier', 'syndic', 'pret immo', 'mrh', 'assurance habitation'] },
  { categoryId: 'mobilite', keywords: ['ratp', 'sncf', 'navigo', 'essence', 'total', 'shell', 'esso', 'autoroute', 'vinci', 'sanef', 'peage', 'parking', 'tcar', 'uber', 'garagiste'] },
  { categoryId: 'telecoms', keywords: ['orange', 'sosh', 'bouygues', 'sfr', 'free', 'red by sfr'] },
  { categoryId: 'loisirs', keywords: ['netflix', 'crunchyroll', 'prime', 'amazon', 'spotify', 'deezer', 'disney', 'xbox', 'playstation', 'cinema', 'cinepass', 'fnac', 'restaurant', 'bar', 'fdj'] },
  { categoryId: 'sante', keywords: ['pharmacie', 'doctolib', 'medecin', 'dentiste', 'optique', 'mutuelle', 'alan', 'osteopathe', 'hopital'] },
  { categoryId: 'animaux', keywords: ['veterinaire', 'veto', 'zooplus', 'croquette', 'maxi zoo', 'animalis'] },
  { categoryId: 'impots', keywords: ['dgfip', 'impot', 'tresor public', 'taxe'] },
  { categoryId: 'banque', keywords: ['cotisation', 'frais bancaire', 'carte', 'assurance', 'protection juridique'] },
  { categoryId: 'epargne', keywords: ['livret', 'amundi', 'pea', 'bricks', 'bitstack', 'epargne', 'virement interne'] },
];

export function guessCategory(label: string, lines: BudgetLine[], categories: Category[]): string {
  const norm = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. Match against user's existing budget line labels
  for (const l of lines) {
    if (!l.categoryId || l.section === 'resource') continue;
    const lineNorm = l.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (lineNorm.length >= 4 && norm.includes(lineNorm)) {
      return l.categoryId;
    }
  }

  // 2. Match against common French banking keywords
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.keywords.some((kw) => norm.includes(kw)) && categories.some((c) => c.id === rule.categoryId)) {
      return rule.categoryId;
    }
  }

  return categories.find((c) => c.id === 'autres')?.id ?? categories[0]?.id ?? 'autres';
}

function splitCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const fr = s.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})$/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  return new Date().toISOString().slice(0, 10);
}

export function parseBankCsv(text: string, lines: BudgetLine[], categories: Category[]): BankTransaction[] {
  const rawLines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rawLines.length < 2) return [];

  const headerLine = rawLines[0];
  const sep = headerLine.includes(';') ? ';' : headerLine.includes('\t') ? '\t' : ',';
  const headers = splitCsvLine(headerLine, sep).map((h) =>
    h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  );

  const dateIdx = headers.findIndex((h) => h.includes('date'));
  const labelIdx = headers.findIndex((h) => h.includes('libelle') || h.includes('label') || h.includes('operation') || h.includes('detail'));
  const amountIdx = headers.findIndex((h) => h.includes('montant') || h.includes('amount'));
  const debitIdx = headers.findIndex((h) => h.includes('debit'));
  const creditIdx = headers.findIndex((h) => h.includes('credit'));

  if (labelIdx === -1 || (amountIdx === -1 && debitIdx === -1 && creditIdx === -1)) {
    return [];
  }

  const out: BankTransaction[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const cols = splitCsvLine(rawLines[i], sep);
    const label = cols[labelIdx] ?? '';
    if (!label) continue;

    let signedAmount = 0;
    if (amountIdx !== -1) {
      const parsed = parseNumber(cols[amountIdx] ?? '');
      if (parsed === null || parsed === 0) continue;
      signedAmount = parsed;
    } else {
      const deb = debitIdx !== -1 ? parseNumber(cols[debitIdx] ?? '') ?? 0 : 0;
      const cred = creditIdx !== -1 ? parseNumber(cols[creditIdx] ?? '') ?? 0 : 0;
      if (deb === 0 && cred === 0) continue;
      signedAmount = cred > 0 ? cred : -Math.abs(deb);
    }

    const type: 'expense' | 'income' = signedAmount >= 0 ? 'income' : 'expense';
    const absAmount = Math.round(Math.abs(signedAmount) * 100) / 100;
    const date = dateIdx !== -1 && cols[dateIdx] ? normalizeDate(cols[dateIdx]) : new Date().toISOString().slice(0, 10);

    out.push({
      id: createId('tx'),
      date,
      label: label.slice(0, 80),
      amount: absAmount,
      type,
      categoryId: type === 'income' ? '' : guessCategory(label, lines, categories),
    });
  }
  return out;
}
