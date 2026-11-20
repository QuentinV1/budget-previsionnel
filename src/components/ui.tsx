import { ReactNode, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatNumberInput, parseNumber } from '../utils/format';

export const MAX_AMOUNT = 10_000_000;

export function Card({ children, className = '', title, action, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900 sm:text-base">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

interface MoneyInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
}

/** Champ numérique tolérant (virgule ou point), validé à la sortie du champ, borné. */
export function MoneyInput({ value, onChange, min = 0, max = MAX_AMOUNT, suffix = '€', className = '', ariaLabel, disabled, placeholder }: MoneyInputProps) {
  const [draft, setDraft] = useState(formatNumberInput(value));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatNumberInput(value));
  }, [value, focused]);

  const commit = () => {
    const n = parseNumber(draft);
    if (n === null) {
      if (draft.trim() === '') onChange(0);
      setDraft(formatNumberInput(draft.trim() === '' ? 0 : value));
      setInvalid(false);
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(n * 100) / 100));
    onChange(clamped);
    setDraft(formatNumberInput(clamped));
    setInvalid(false);
  };

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        value={draft}
        maxLength={14}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseNumber(e.target.value);
          setInvalid(e.target.value.trim() !== '' && (n === null || n < min || n > max));
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(formatNumberInput(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`w-full rounded-lg border bg-white py-1.5 pr-7 pl-2 text-right text-sm tabular-nums outline-none transition focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500 ${
          invalid ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-200 hover:border-slate-300 focus:border-indigo-400 focus:ring-indigo-100'
        }`}
      />
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>
    </div>
  );
}

export function TextInput({ value, onChange, className = '', placeholder, ariaLabel, maxLength = 80 }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; ariaLabel?: string; maxLength?: number }) {
  return (
    <input
      type="text"
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none transition hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 ${className}`}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

export function Segmented<T extends string>({ options, value, onChange, size = 'sm' }: { options: { id: T; label: ReactNode; title?: string }[]; value: T; onChange: (v: T) => void; size?: 'xs' | 'sm' }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          title={o.title}
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap transition ${size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} ${
            value === o.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Button({ children, onClick, variant = 'secondary', className = '', type = 'button', disabled, title }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; className?: string; type?: 'button' | 'submit'; disabled?: boolean; title?: string }) {
  const styles = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800',
    secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 sm:text-sm ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Kpi({ label, value, hint, tone = 'default', icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'bad' | 'accent'; icon?: ReactNode }) {
  const toneCls = {
    default: 'border-slate-200 bg-white',
    good: 'border-emerald-200 bg-emerald-50/50',
    bad: 'border-rose-200 bg-rose-50/50',
    accent: 'border-indigo-200 bg-indigo-50/40',
  }[tone];
  const valueCls = { default: 'text-slate-900', good: 'text-emerald-700', bad: 'text-rose-700', accent: 'text-indigo-700' }[tone];
  return (
    <div className={`rounded-2xl border p-4 shadow-xs ${toneCls}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{label}</span>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <p className={`mt-2 text-xl font-bold tracking-tight tabular-nums sm:text-2xl ${valueCls}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function ProgressBar({ value, color = '#6366f1', className = '' }: { value: number; color?: string; className?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">{children}</p>;
}
