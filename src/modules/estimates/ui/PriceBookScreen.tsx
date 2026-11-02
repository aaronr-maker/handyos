import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { centsToInput, formatMoney, parseMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { addPriceItemAction, setPriceItemActiveAction, updatePriceItemAction } from '../priceBookActions';
import { listPriceItems } from '../services/priceBookService';
import type { PriceBookItem, PriceKind } from '../types';

const KINDS: PriceKind[] = ['service', 'material', 'fee'];

interface PriceItemValues {
  name: string;
  description: string | null;
  kind: PriceKind;
  unit: string;
  unit_price_cents: number;
  unit_cost_cents: number;
  taxable: boolean;
}

function ItemForm({ initial, onSubmit, onCancel }: { initial?: PriceBookItem; onSubmit(v: PriceItemValues): Promise<string | null>; onCancel(): void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [kind, setKind] = useState<PriceKind>(initial?.kind ?? 'service');
  const [unit, setUnit] = useState(initial?.unit ?? 'each');
  const [price, setPrice] = useState(initial ? centsToInput(initial.unit_price_cents) : '');
  const [cost, setCost] = useState(initial ? centsToInput(initial.unit_cost_cents) : '');
  const [taxable, setTaxable] = useState(initial?.taxable ?? true);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const unit_price_cents = parseMoney(price);
    const unit_cost_cents = cost.trim() === '' ? 0 : parseMoney(cost);
    if (unit_price_cents === null || unit_cost_cents === null) return setError('Enter prices as plain amounts, like 95 or 95.50');
    setError(await onSubmit({ name, description: description.trim() || null, kind, unit, unit_price_cents, unit_cost_cents, taxable }));
  };

  return (
    <form className="card" onSubmit={submit}>
      <label>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description <span className="muted">(optional, shown to the customer)</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="row">
        <label className="grow">
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as PriceKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Unit
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="each, hour, ft…" />
        </label>
      </div>
      <div className="row">
        <label className="grow">
          You charge ($)
          <input inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="grow">
          It costs you ($)
          <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="optional" />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
        Taxable
      </label>
      {error && <p className="err">{error}</p>}
      <div className="row">
        <button>{initial ? 'Save changes' : 'Add to price book'}</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function PriceBookScreen() {
  const { companyId } = useSession();
  const addItem = useAction(addPriceItemAction);
  const updateItem = useAction(updatePriceItemAction);
  const setActive = useAction(setPriceItemActiveAction);
  const { data, loading, error, reload } = useAsync(() => listPriceItems(companyId), [companyId]);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown = (data ?? []).filter((i) => (showHidden || i.active) && (!q || `${i.name} ${i.description ?? ''}`.toLowerCase().includes(q)));

  return (
    <section className="page">
      <Link to=".." relative="path" className="muted">
        ← Estimates
      </Link>
      <header className="page-header">
        <div>
          <h1>Price book</h1>
          <p className="muted">What you quote from: services, materials and fees.</p>
        </div>
        <button className="push-right" onClick={() => setAdding(true)}>
          Add item
        </button>
      </header>

      {adding && (
        <ItemForm
          onCancel={() => setAdding(false)}
          onSubmit={async (v) => {
            const message = resultError(await addItem(v));
            if (!message) {
              setAdding(false);
              reload();
            }
            return message;
          }}
        />
      )}

      <input type="search" placeholder="Search the price book" value={query} onChange={(e) => setQuery(e.target.value)} />
      <label className="check">
        <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
        Show hidden items
      </label>
      {(error || problem) && <p className="err">{error ?? problem}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && shown.length === 0 && (
        <div className="card">
          <p className="muted">{data.length === 0 ? 'Your price book is empty. Add your first service.' : 'Nothing matches.'}</p>
        </div>
      )}

      {shown.map((i) =>
        editing === i.id ? (
          <ItemForm
            key={i.id}
            initial={i}
            onCancel={() => setEditing(null)}
            onSubmit={async (v) => {
              const message = resultError(await updateItem({ item_id: i.id, ...v }));
              if (!message) {
                setEditing(null);
                reload();
              }
              return message;
            }}
          />
        ) : (
          <div key={i.id} className={`card item ${i.active ? '' : 'faded'}`}>
            <div>
              <strong>{i.name}</strong> <span className="pill">{i.kind}</span> {!i.active && <span className="pill">hidden</span>}
              {i.description && <div className="muted">{i.description}</div>}
              <div className="muted">
                {formatMoney(i.unit_price_cents)} per {i.unit}
                {i.unit_cost_cents > 0 && ` · costs you ${formatMoney(i.unit_cost_cents)}`}
                {!i.taxable && ' · not taxable'}
              </div>
            </div>
            <div className="row small">
              <button className="link" onClick={() => setEditing(i.id)}>
                Edit
              </button>
              <button
                className="link"
                onClick={async () => {
                  const message = resultError(await setActive({ item_id: i.id, active: !i.active }));
                  setProblem(message);
                  if (!message) reload();
                }}
              >
                {i.active ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        ),
      )}
    </section>
  );
}
