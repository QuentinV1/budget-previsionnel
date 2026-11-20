const euro2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euro0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function formatEuro(amount: number, decimals = true): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return (decimals ? euro2 : euro0).format(Math.abs(safe) < 0.005 ? 0 : safe);
}

export function formatCompact(amount: number): string {
  const a = Math.abs(amount);
  if (a >= 1_000_000) return `${(amount / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
  if (a >= 10_000) return `${Math.round(amount / 1000).toLocaleString('fr-FR')} k€`;
  return formatEuro(amount, false);
}

/** ratio 0..1 → "8,4 %" */
export function formatPct(ratio: number, digits = 1): string {
  const safe = Number.isFinite(ratio) ? ratio : 0;
  return `${(safe * 100).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

export function formatNumberInput(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

export function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s|€|%|\u202f|\u00a0/g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
