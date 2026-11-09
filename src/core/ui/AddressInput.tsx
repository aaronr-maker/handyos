import { useEffect, useRef, useState } from 'react';
import { apiCall } from '../integrations';

/**
 * A text box for a street address that suggests matches as you type (from the map service on the server). You can always just type
 * the whole address: when suggestions are not available it behaves like a normal box. `onCommit` runs when a suggestion is picked or
 * the box is left.
 */
export function AddressInput({ value, onChange, onCommit, placeholder }: { value: string; onChange: (v: string) => void; onCommit?: (v: string) => void; placeholder?: string }) {
  const [options, setOptions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const typed = useRef(false);

  // look up suggestions shortly after typing stops (only for what the person typed, not for a value that was chosen)
  useEffect(() => {
    if (!typed.current || value.trim().length < 4) return;
    let live = true;
    const timer = setTimeout(() => {
      apiCall<{ suggestions: string[] }>('/api/travel/suggest', { text: value })
        .then((r) => {
          if (live) {
            setOptions(r.suggestions);
            setOpen(r.suggestions.length > 0);
          }
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [value]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => options.length > 0 && setOpen(true)}
        onBlur={() => {
          setOpen(false);
          onCommit?.(value);
        }}
      />
      {open && options.length > 0 && (
        <ul className="address-options" role="listbox">
          {options.map((o) => (
            <li
              key={o}
              role="option"
              aria-selected={false}
              // mouse down (not click) so it lands before the box loses focus
              onMouseDown={(e) => {
                e.preventDefault();
                typed.current = false;
                onChange(o);
                setOpen(false);
                onCommit?.(o);
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
