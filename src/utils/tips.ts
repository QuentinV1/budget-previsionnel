import { BudgetState } from '../types';
import { HouseholdSummary, isTransfer } from './calc';
import { accountBalance, computeLoan, computeProrata, computeReserve, leverCurrent } from './finance';
import { formatEuro, formatPct } from './format';

export type TipLevel = 'alerte' | 'attention' | 'conseil' | 'ok';

export interface Tip {
  id: string;
  level: TipLevel;
  title: string;
  detail: string;
  /** Gain mensuel potentiel estimé */
  gain?: number;
  action?: { label: string; kind: 'prorata' | 'goto'; target?: string };
}

const has = (state: BudgetState, re: RegExp) => state.lines.some((l) => re.test(l.label));

export function computeTips(state: BudgetState, s: HouseholdSummary): Tip[] {
  const tips: Tip[] = [];
  const cat = (id: string) => s.byCategory.find((c) => c.category.id === id)?.amount ?? 0;
  const reserve = computeReserve(state, s);

  // 1. Soldes négatifs
  for (const sh of s.sheets) {
    if (sh.soldeApresDettes < -0.005) {
      tips.push({
        id: `neg-${sh.sheet.id}`,
        level: 'alerte',
        title: `Budget - ${sh.sheet.name} en déficit`,
        detail: `Le solde après dettes est de ${formatEuro(sh.soldeApresDettes)} par mois. Réduire des dépenses ou ajuster les virements.`,
        action: { label: 'Ouvrir le budget', kind: 'goto', target: sh.sheet.id },
      });
    }
  }

  // 2. Taux d'épargne
  if (s.income > 0) {
    if (s.savingsRate < 0.1) {
      const target = s.income * 0.15;
      tips.push({
        id: 'savings-rate',
        level: 'attention',
        title: `Taux d'épargne faible : ${formatPct(s.savingsRate)}`,
        detail: `${formatEuro(s.savings)} épargnés sur ${formatEuro(s.income)} de revenus. Viser 15 % représenterait ${formatEuro(target)} / mois (+${formatEuro(target - s.savings)}). La capacité théorique est de ${formatPct(s.potentialSavingsRate)}.`,
        gain: Math.max(0, Math.min(target - s.savings, s.margin)),
      });
    } else {
      tips.push({
        id: 'savings-rate',
        level: 'ok',
        title: `Taux d'épargne de ${formatPct(s.savingsRate)}`,
        detail: 'Au-dessus du repère de 10 %. Viser 15 à 20 % si la marge le permet.',
      });
    }
  }

  // 3. Marge non affectée
  if (s.margin > 50) {
    tips.push({
      id: 'margin',
      level: 'conseil',
      title: `${formatEuro(s.margin)} non affectés chaque mois`,
      detail: `Cette marge n'a pas de destination définie : elle risque d'être dépensée sans s'en rendre compte. Proposition : ${formatEuro(s.margin * 0.5)} vers l'épargne (réserve puis placements) et garder ${formatEuro(s.margin * 0.5)} pour les imprévus et dépenses non budgétées.`,
    });
  }

  // 4. Réserve de sécurité
  if (reserve.gap > 0) {
    const months = s.savings > 0 ? Math.ceil(reserve.gap / s.savings) : null;
    tips.push({
      id: 'reserve',
      level: 'attention',
      title: `Réserve de sécurité incomplète : il manque ${formatEuro(reserve.gap)}`,
      detail: `Livrets : ${formatEuro(reserve.livrets)} pour un repère de ${state.assumptions.reserveMonths} mois de dépenses (${formatEuro(reserve.target)}).${months ? ` Au rythme actuel, comblé en ${months} mois.` : ''}`,
      action: { label: 'Voir l’épargne', kind: 'goto', target: 'epargne' },
    });
  } else if (reserve.target > 0) {
    tips.push({
      id: 'reserve',
      level: 'ok',
      title: `Réserve de sécurité couverte (${reserve.monthsCovered.toFixed(1)} mois)`,
      detail: 'Au-delà du repère, l’épargne supplémentaire peut être placée à plus long terme.',
    });
  }
  for (const p of reserve.perPerson) {
    if (p.monthlyNeed > 0 && p.monthsCovered < 2) {
      tips.push({
        id: `reserve-${p.sheetId}`,
        level: 'attention',
        title: `${p.name} : ${p.monthsCovered.toFixed(1)} mois de dépenses sur livret`,
        detail: `${formatEuro(p.livrets)} de livrets pour ~${formatEuro(p.monthlyNeed)} / mois de dépenses personnelles (contribution au commun incluse). Prioriser l'épargne de précaution personnelle avant les placements.`,
      });
    }
  }

  // 5. Endettement
  if (s.salaries > 0) {
    const r = s.creditToSalary;
    tips.push({
      id: 'debt-ratio',
      level: r > 0.35 ? 'alerte' : r > 0.3 ? 'attention' : 'ok',
      title: `Taux d'endettement : ${formatPct(r)}`,
      detail: `${formatEuro(s.credits)} de mensualités pour ${formatEuro(s.salaries)} de salaires. Le repère bancaire est de 35 % maximum.`,
    });
  }

  // 6. Répartition des virements vers chaque budget commun
  for (const common of state.sheets.filter((x) => x.kind === 'common')) {
    const pr = computeProrata(state, s, common.id);
    const maxDelta = Math.max(0, ...pr.rows.map((r) => Math.abs(r.delta)));
    if (pr.totalCurrent > 0 && pr.rows.length > 1 && maxDelta >= 20) {
      tips.push({
        id: `prorata-${common.id}`,
        level: 'conseil',
        title: `Répartition du budget ${common.name} : écart au prorata de ${formatEuro(maxDelta)}`,
        detail: pr.rows
          .map((r) => `${r.sheet.name} verse ${formatEuro(r.current)} (prorata salaires : ${formatEuro(r.prorata)})`)
          .join(' · '),
        action: { label: 'Appliquer le prorata', kind: 'prorata', target: common.id },
      });
    }
    const sh = s.sheets.find((x) => x.sheet.id === common.id);
    if (sh && sh.totalResources > 0 && sh.soldeApresDettes >= 0 && sh.soldeApresDettes < Math.max(100, sh.totalResources * 0.03)) {
      tips.push({
        id: `thin-${common.id}`,
        level: 'conseil',
        title: `Marge du compte ${common.name} serrée : ${formatEuro(sh.soldeApresDettes)}`,
        detail: 'Une facture plus élevée que prévu (énergie, véto…) mettra le compte à découvert. Garder un petit matelas sur le compte ou augmenter légèrement les virements.',
      });
    }
  }

  // 7. Leviers / postes lourds
  if (s.income > 0) {
    const mob = cat('mobilite');
    if (mob / s.income > 0.2) {
      tips.push({
        id: 'mobilite',
        level: 'conseil',
        title: `Mobilité : ${formatPct(mob / s.income)} des revenus (${formatEuro(mob)})`,
        detail: 'Poste le plus lourd après le logement. Vérifier les remboursements employeur, comparer les assurances auto et provisionner entretien / pneus.',
      });
    }
    const alim = cat('alimentation');
    if (alim / s.income > 0.15) {
      tips.push({
        id: 'alim',
        level: 'conseil',
        title: `Alimentation : ${formatEuro(alim)} / mois (${formatPct(alim / s.income)})`,
        detail: 'Les courses, HelloFresh et achats individuels s’additionnent. Fixer un plafond global plutôt que par compte.',
        gain: state.levers.find((l) => l.id === 'lev-alim')?.reduction,
      });
    }
    const housing = cat('logement');
    if (housing / s.income > 0.33) {
      tips.push({
        id: 'logement',
        level: 'attention',
        title: `Logement : ${formatPct(housing / s.income)} des revenus`,
        detail: 'Au-delà d’un tiers des revenus, le budget devient rigide. Renégocier l’assurance emprunteur peut faire gagner plusieurs dizaines d’euros.',
      });
    }
  }
  for (const lever of state.levers) {
    const cur = leverCurrent(lever, s.monthly);
    if (lever.id === 'lev-alim' || cur <= 0 || lever.reduction <= 0) continue;
    tips.push({
      id: `lever-${lever.id}`,
      level: 'conseil',
      title: `${lever.label} : ${formatEuro(cur)} / mois`,
      detail: lever.action || `Objectif de baisse : ${formatEuro(lever.reduction)}.`,
      gain: Math.min(cur, lever.reduction),
    });
  }

  // 8. Postes probablement manquants
  const missing: string[] = [];
  const zeroLines = state.lines.filter((l) => l.section !== 'resource' && !isTransfer(l) && l.mode === 'monthly' && l.amount === 0 && /compl/i.test(l.comment));
  for (const l of zeroLines) missing.push(l.label);
  if (!has(state, /imp[oô]t sur le revenu|\bIR\b|pr[ée]l[èe]vement [àa] la source/i)) missing.push('Impôt sur le revenu (si non prélevé à la source)');
  if (!has(state, /entretien|r[ée]vision|pneu/i)) missing.push('Entretien / révision des voitures');
  if (!has(state, /travaux|entretien maison|bricolage/i)) missing.push('Entretien du logement / travaux');
  if (!has(state, /cadeau|anniversaire/i)) missing.push('Cadeaux & anniversaires');
  if (missing.length) {
    tips.push({
      id: 'missing',
      level: 'attention',
      title: `${missing.length} poste(s) probablement manquant(s)`,
      detail: `Champs vides ≠ dépenses nulles : ${missing.join(' · ')}.`,
    });
  }

  // 9. Crédits qui se terminent bientôt
  for (const loan of state.loans) {
    const info = computeLoan(loan, s.monthly);
    if (info.monthsLeft != null && info.monthsLeft <= 36 && info.monthly > 0) {
      tips.push({
        id: `loan-end-${loan.id}`,
        level: 'conseil',
        title: `${loan.name} : fin dans ${info.monthsLeft} mois`,
        detail: `${formatEuro(info.monthly)} / mois libérés à partir de ${info.endLabel}, soit ${formatEuro(info.monthly * 12)} par an. Prévoir dès maintenant de les réaffecter à l'épargne.`,
        gain: info.monthly,
      });
    }
  }

  // 10. Plafonds des livrets réglementés
  for (const a of state.accounts) {
    const bal = accountBalance(a);
    if (/livret a/i.test(a.name) && bal > 22950) {
      tips.push({ id: `cap-${a.id}`, level: 'conseil', title: `${a.name} au-dessus du plafond`, detail: 'Le Livret A est plafonné à 22 950 € (hors intérêts).' });
    }
    if (/\blep\b/i.test(a.name)) {
      tips.push({
        id: `lep-${a.id}`,
        level: bal >= 10000 ? 'conseil' : 'ok',
        title: bal >= 10000 ? 'LEP au plafond' : `LEP : encore ${formatEuro(10000 - bal)} de place`,
        detail: bal >= 10000
          ? 'Le LEP est plafonné à 10 000 € : orienter les versements suivants vers un autre support.'
          : 'Le LEP est le livret réglementé le mieux rémunéré : prioriser son remplissage jusqu’à 10 000 €.',
      });
    }
  }

  const order: Record<TipLevel, number> = { alerte: 0, attention: 1, conseil: 2, ok: 3 };
  return tips.sort((a, b) => order[a.level] - order[b.level]);
}

/** Score de santé financière 0–100 (indicatif). */
export function computeScore(state: BudgetState, s: HouseholdSummary) {
  const reserve = computeReserve(state, s);
  const parts = [
    { label: "Taux d'épargne", value: Math.min(1, s.savingsRate / 0.15), weight: 30 },
    { label: 'Réserve de sécurité', value: Math.min(1, reserve.monthsCovered / Math.max(1, state.assumptions.reserveMonths)), weight: 25 },
    { label: 'Endettement', value: s.creditToSalary <= 0.25 ? 1 : Math.max(0, 1 - (s.creditToSalary - 0.25) / 0.15), weight: 25 },
    { label: 'Équilibre des budgets', value: s.sheets.every((x) => x.soldeApresDettes >= 0) ? 1 : 0.3, weight: 20 },
  ];
  const score = Math.round(parts.reduce((t, p) => t + p.value * p.weight, 0));
  return { score, parts };
}
