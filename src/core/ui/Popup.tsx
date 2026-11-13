import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface PopupItem {
  label: string;
  /** An outside link (tel:, sms:, maps) or an in-app route. */
  href?: string;
  to?: string;
}

/** A name or address you can tap for a small menu of things to do with it. Closes on a tap elsewhere or Escape. */
export function Popup({ children, items, title }: { children: ReactNode; items: PopupItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (items.length === 0) return <>{children}</>;
  return (
    <span className="popup" ref={box}>
      <button type="button" className="popup-trigger" aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)}>
        {children}
      </button>
      {open && (
        <span className="popup-menu" role="menu">
          {items.map((i) =>
            i.to ? (
              <Link key={i.label} to={i.to} role="menuitem" onClick={() => setOpen(false)}>
                {i.label}
              </Link>
            ) : (
              <a key={i.label} href={i.href} role="menuitem" onClick={() => setOpen(false)}>
                {i.label}
              </a>
            ),
          )}
        </span>
      )}
    </span>
  );
}
