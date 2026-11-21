import { useRef, useState } from 'react';
import { Download, ExternalLink, FileSpreadsheet, LayoutGrid, Plus, RotateCcw, Trash2, Upload, User, Users } from 'lucide-react';
import { createDefaultState } from '../data/defaultData';
import { BudgetState, Bucket, SHEET_COLORS, Sheet, SheetColor, SheetKind } from '../types';
import { createId } from '../utils/format';
import { exportCsv, exportJson, parseImported } from '../utils/storage';
import { Button, Field, Modal, inputCls } from './ui';
import { Updater } from './SheetPage';

interface Props {
  open: boolean;
  onClose: () => void;
  state: BudgetState;
  update: Updater;
  onSheetRemoved: (id: string) => void;
}

const COLOR_KEYS = Object.keys(SHEET_COLORS) as SheetColor[];

export function SettingsModal({ open, onClose, state, update, onSheetRemoved }: Props) {
  const [newSheetName, setNewSheetName] = useState('');
  const [newSheetKind, setNewSheetKind] = useState<SheetKind>('person');
  const [newSheetColor, setNewSheetColor] = useState<SheetColor>('emerald');

  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');
  const [newCatBucket, setNewCatBucket] = useState<Bucket>('besoin');

  const [importError, setImportError] = useState('');
  const [showOtherApps, setShowOtherApps] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addSheet = () => {
    const name = newSheetName.trim();
    if (!name) return;
    const sheet: Sheet = {
      id: createId('sheet'),
      name,
      kind: newSheetKind,
      color: newSheetColor,
    };
    update((s) => ({ ...s, sheets: [...s.sheets, sheet] }));
    setNewSheetName('');
  };

  const removeSheet = (sheet: Sheet) => {
    if (state.sheets.length <= 1) return;
    update((s) => ({
      ...s,
      sheets: s.sheets.filter((x) => x.id !== sheet.id),
      lines: s.lines.filter((l) => l.sheetId !== sheet.id && l.targetSheetId !== sheet.id),
      accounts: s.accounts.filter((a) => a.ownerId !== sheet.id),
      loans: s.loans.filter((l) => l.ownerId !== sheet.id),
    }));
    onSheetRemoved(sheet.id);
  };

  const addCategory = () => {
    const label = newCatLabel.trim();
    if (!label) return;
    update((s) => ({
      ...s,
      categories: [...s.categories, { id: createId('cat'), label, color: newCatColor, bucket: newCatBucket }],
    }));
    setNewCatLabel('');
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseImported(String(reader.result ?? ''));
      if (!parsed) {
        setImportError('Fichier JSON invalide ou incompatible.');
        return;
      }
      setImportError('');
      update(() => parsed);
    };
    reader.readAsText(file);
  };

  return (
    <Modal open={open} onClose={onClose} title="Paramètres du foyer & budgets" wide>
      <div className="space-y-6">
        {/* Feuilles de budget */}
        <section>
          <h4 className="mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">
            Budgets (feuilles de saisie)
          </h4>
          <div className="space-y-2">
            {state.sheets.map((sh) => (
              <div key={sh.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-2.5">
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-white ${SHEET_COLORS[sh.color].bg}`}>
                  {sh.kind === 'common' ? <Users className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                </span>
                <input
                  type="text"
                  value={sh.name}
                  maxLength={32}
                  aria-label={`Nom du budget ${sh.name}`}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      sheets: s.sheets.map((x) => (x.id === sh.id ? { ...x, name: e.target.value } : x)),
                    }))
                  }
                  className="min-w-[120px] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
                <select
                  aria-label={`Type de budget ${sh.name}`}
                  value={sh.kind}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      sheets: s.sheets.map((x) => (x.id === sh.id ? { ...x, kind: e.target.value as SheetKind } : x)),
                    }))
                  }
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                >
                  <option value="person">Personne</option>
                  <option value="common">Commun</option>
                </select>
                <select
                  aria-label={`Couleur ${sh.name}`}
                  value={sh.color}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      sheets: s.sheets.map((x) => (x.id === sh.id ? { ...x, color: e.target.value as SheetColor } : x)),
                    }))
                  }
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                >
                  {COLOR_KEYS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={state.sheets.length <= 1}
                  onClick={() => removeSheet(sh)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                  title="Supprimer ce budget"
                  aria-label={`Supprimer Budget - ${sh.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
            <Field label="Ajouter un budget">
              <input
                className={inputCls}
                maxLength={32}
                value={newSheetName}
                placeholder="ex : Enfant, Travaux, Compte 2…"
                onChange={(e) => setNewSheetName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSheet()}
              />
            </Field>
            <Field label="Type">
              <select className={inputCls} value={newSheetKind} onChange={(e) => setNewSheetKind(e.target.value as SheetKind)}>
                <option value="person">Personne</option>
                <option value="common">Commun</option>
              </select>
            </Field>
            <Field label="Couleur">
              <select className={inputCls} value={newSheetColor} onChange={(e) => setNewSheetColor(e.target.value as SheetColor)}>
                {COLOR_KEYS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="primary" onClick={addSheet}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>
        </section>

        {/* Types de dépenses */}
        <section>
          <h4 className="mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">
            Types de dépenses (Synthèse)
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {state.categories.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.label}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
            <Field label="Nouveau type">
              <input className={inputCls} maxLength={40} value={newCatLabel} placeholder="ex : Vacances, Sport…" onChange={(e) => setNewCatLabel(e.target.value)} />
            </Field>
            <Field label="Couleur">
              <input type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)} className="h-[34px] w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5" />
            </Field>
            <Field label="50/30/20">
              <select className={inputCls} value={newCatBucket} onChange={(e) => setNewCatBucket(e.target.value as Bucket)}>
                <option value="besoin">Besoin</option>
                <option value="envie">Envie</option>
                <option value="epargne">Épargne</option>
              </select>
            </Field>
            <Button onClick={addCategory}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>
        </section>

        {/* Données & Sauvegarde */}
        <section>
          <h4 className="mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">
            Données & Sauvegarde
          </h4>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => exportCsv(state)}>
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Export CSV consolidé
            </Button>
            <Button onClick={() => exportJson(state)}>
              <Download className="h-3.5 w-3.5" /> Sauvegarde JSON
            </Button>
            <Button onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Importer JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = '';
              }}
            />
            <Button
              variant="danger"
              onClick={() => {
                update(() => createDefaultState());
              }}
              className="ml-auto"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser (données Excel)
            </Button>
          </div>
          {importError && <p className="mt-2 text-xs text-rose-600">{importError}</p>}
        </section>

        {/* Mes autres applications */}
        <section className="border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                Mes autres applications
              </h4>
              <p className="mt-0.5 text-xs text-slate-500">
                Accéder rapidement aux autres applications web (GitHub Pages).
              </p>
            </div>
            <Button variant="primary" onClick={() => setShowOtherApps(true)}>
              <LayoutGrid className="h-3.5 w-3.5" /> Mes autres applications
            </Button>
          </div>
        </section>
      </div>

      <Modal open={showOtherApps} onClose={() => setShowOtherApps(false)} title="Mes autres applications">
        <div className="space-y-2.5">
          <p className="text-xs text-slate-500">
            Retrouvez toutes les autres applications hébergées sur GitHub Pages.
          </p>
          <div className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1">
            {[
              { name: "L'Affinoir", desc: "Charcuterie, salaisons & cave d'affinage", url: 'https://quentinv1.github.io/app-charcuterie/' },
              { name: 'Pêche France', desc: 'Réglementation, mailles, cartes & carnet de prises', url: 'https://quentinv1.github.io/app-peche/' },
              { name: 'App Voyage', desc: "Planificateur d'itinéraire, carte & carnet de voyage", url: 'https://quentinv1.github.io/app-voyage/' },
              { name: 'Cave à vin', desc: 'Stock de bouteilles, apogée & dégustations', url: 'https://quentinv1.github.io/cave-a-vin/' },
              { name: 'Checklist Valise', desc: 'Bagages, calculateur de poids & règles IATA', url: 'https://quentinv1.github.io/checklist-valise/' },
              { name: 'Livre de recettes', desc: 'Recettes, planning semaine & liste de courses', url: 'https://quentinv1.github.io/livre-recettes/' },
              { name: 'Suivi Chasse', desc: 'Carnet de sorties, carte & album trophées', url: 'https://quentinv1.github.io/suivi-chasse/' },
              { name: 'Travaux Maison', desc: 'Plan 2D/3D, courses, tâches & entretien', url: 'https://quentinv1.github.io/travaux-maison/' },
            ].map((app) => (
              <a
                key={app.url}
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 transition hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">{app.name}</div>
                  <div className="truncate text-xs text-slate-500">{app.desc}</div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-indigo-600">
                  Ouvrir <ExternalLink className="h-3.5 w-3.5" />
                </span>
              </a>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={() => setShowOtherApps(false)}>Fermer</Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
