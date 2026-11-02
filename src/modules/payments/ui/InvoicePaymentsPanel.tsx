import { useState, type FormEvent } from 'react';
import { centsToInput, formatMoney, parseMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { balanceOf, type Invoice } from '@/modules/invoicing';
import { recordPaymentAction, refundPaymentAction } from '../actions';
import { listPaymentsFor } from '../services/paymentService';
import type { PaymentMethod } from '../types';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'check', label: 'Check' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];
const methodLabel = (m: PaymentMethod) => METHODS.find((x) => x.value === m)?.label ?? m;
const today = () => new Date().toISOString().slice(0, 10);

/** Payments on one invoice: the list, a form to record a payment, and (owners/admins) refunds. */
export function InvoicePaymentsPanel({ invoice, onChanged }: { invoice: Invoice; onChanged(): void }) {
  const { companyId, role } = useSession();
  const record = useAction(recordPaymentAction);
  const refund = useAction(refundPaymentAction);
  const { data, reload } = useAsync(() => listPaymentsFor(companyId, invoice.id), [companyId, invoice.id, invoice.amount_paid_cents]);

  const balance = balanceOf(invoice);
  const canTakePayment = (invoice.status === 'sent' || invoice.status === 'overdue') && balance > 0 && role !== 'tech';
  const canRefund = (role === 'owner' || role === 'admin') && invoice.amount_paid_cents > 0 && invoice.status !== 'void';

  const [amount, setAmount] = useState(centsToInput(balance));
  const [method, setMethod] = useState<PaymentMethod>('check');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [reason, setReason] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setError('Enter an amount like 95 or 95.50');
    const message = resultError(await record({ invoice_id: invoice.id, amount_cents: cents, method, received_on: date, note: note.trim() || null }));
    setError(message);
    if (!message) {
      setNote('');
      reload();
      onChanged();
    }
  };

  const submitRefund = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(refundAmount);
    if (cents === null) return setError('Enter an amount like 95 or 95.50');
    if (!confirm(`Refund ${formatMoney(cents)}? This is recorded on the invoice.`)) return;
    const message = resultError(await refund({ invoice_id: invoice.id, amount_cents: cents, method: 'other', reason }));
    setError(message);
    if (!message) {
      setRefunding(false);
      setRefundAmount('');
      setReason('');
      reload();
      onChanged();
    }
  };

  return (
    <div className="card">
      <h2>Payments</h2>
      {data?.length === 0 && <p className="muted">No payments yet.</p>}
      {data?.map((p) => (
        <div key={p.id} className="contact-row">
          <div>
            <strong>{p.amount_cents < 0 ? 'Refund' : methodLabel(p.method)}</strong>
            <div className="muted">
              {p.received_on}
              {p.note && ` · ${p.note}`}
            </div>
          </div>
          <div>{formatMoney(p.amount_cents)}</div>
        </div>
      ))}
      {error && <p className="err">{error}</p>}

      {canTakePayment && (
        <form onSubmit={submit} className="subform">
          <h2 className="sub-h">Record a payment</h2>
          <div className="row">
            <label className="grow">
              Amount ($)
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="grow">
              How paid
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <label className="grow">
              Date received
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="grow">
              Note <span className="muted">(check #, etc.)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <button>Record payment</button>
        </form>
      )}

      {canRefund &&
        (refunding ? (
          <form onSubmit={submitRefund} className="subform">
            <h2 className="sub-h">Refund</h2>
            <div className="row">
              <label className="grow">
                Amount ($)
                <input inputMode="decimal" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
              </label>
              <label className="grow">
                Why
                <input required value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            </div>
            <div className="row">
              <button>Record refund</button>
              <button type="button" className="secondary" onClick={() => setRefunding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="link" onClick={() => setRefunding(true)}>
            Refund part or all
          </button>
        ))}
    </div>
  );
}
