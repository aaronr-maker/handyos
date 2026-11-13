import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

export interface MoreMenuItem {
  label: string;
  /** a page to go to */
  to?: string;
  /** or something to do */
  onClick?: () => void;
}

/** A three-dot (vertical) button that opens a short list of less-used actions. Closes when you pick one, click away, or press Escape. */
export function MoreMenu({ items, label = 'More' }: { items: MoreMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="more-menu" ref={box}>
      <button type="button" className="more-button secondary" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2.2" />
          <circle cx="12" cy="12" r="2.2" />
          <circle cx="12" cy="19" r="2.2" />
        </svg>
      </button>
      {open && (
        <div className="more-list" role="menu">
          {items.map((i) =>
            i.to ? (
              <Link key={i.label} to={i.to} role="menuitem" onClick={() => setOpen(false)}>
                {i.label}
              </Link>
            ) : (
              <button
                key={i.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  i.onClick?.();
                }}
              >
                {i.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
