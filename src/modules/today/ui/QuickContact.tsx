import { useEffect, useRef, useState } from 'react';
import { digits } from '@/core';
import { matchContacts, type Contactable } from '../calc';

/** Top-left Call / Text buttons: type a name or number, pick a customer, and call or text from your phone. */
export function QuickContact({ people }: { people: Contactable[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
    };
  }, [open]);
  const found = matchContacts(people, q);
  const typed = digits(q);
  const isNumber = typed.replace(/\D/g, '').length >= 7;
  return (
    <div className="quick-contact" ref={box}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Call / Text
      </button>
      {open && (
        <div className="quick-panel">
          <input autoFocus type="search" placeholder="Name or phone number" value={q} onChange={(e) => setQ(e.target.value)} />
          {isNumber && (
            <div className="quick-row">
              <span>{q}</span>
              <a className="button" href={`tel:${typed}`}>Call</a>
              <a className="button secondary" href={`sms:${typed}`}>Text</a>
            </div>
          )}
          {found.map((c) => (
            <div className="quick-row" key={c.id}>
              <span>
                {c.label}
                <small className="muted"> {c.phone ?? 'no number'}</small>
              </span>
              {c.phone && (
                <>
                  <a className="button" href={`tel:${digits(c.phone)}`}>Call</a>
                  <a className="button secondary" href={`sms:${digits(c.phone)}`}>Text</a>
                </>
              )}
            </div>
          ))}
          {q.trim() && !isNumber && found.length === 0 && <p className="muted">No one found. Type a full phone number to call it.</p>}
        </div>
      )}
    </div>
  );
}
