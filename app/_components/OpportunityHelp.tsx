'use client';

import { useEffect, useState } from 'react';

// Tiny popover listing the keyboard shortcuts. Triggered by clicking the
// "?" hint pill or hitting `?`. The OpportunityList dispatches the `?`
// key by clicking the `data-opp-help` element so the keyboard surface
// stays in one place.

const ROWS: Array<{ keys: string; label: string }> = [
  { keys: 'j / ↓', label: 'Next opportunity' },
  { keys: 'k / ↑', label: 'Previous opportunity' },
  { keys: 'o / ↵', label: 'Open in drawer' },
  { keys: 'Esc', label: 'Close drawer' },
  { keys: 'e', label: 'Toggle more actions on the active card' },
  { keys: 's', label: 'Tag strong opportunity (calibration)' },
  { keys: 'i', label: 'Ignore' },
  { keys: 'r', label: 'Revisit later' },
  { keys: 'v', label: 'Likely high value' },
  { keys: 'f', label: 'Likely fast close' },
  { keys: 'w', label: 'Wrong campaign' },
  { keys: 't', label: 'High trust barrier' },
  { keys: 'm', label: 'Needs investigation' },
  { keys: 'g / G', label: 'Jump to first / last' },
];

export function OpportunityHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) setOpen(false);
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="kbd-hint-btn"
        data-opp-help
        onClick={() => setOpen((o) => !o)}
        title="Keyboard shortcuts (?)"
      >
        ? Shortcuts
      </button>
      {open && (
        <div className="kbd-help-pop" role="dialog" aria-label="Keyboard shortcuts">
          <header className="kbd-help-head">
            Keyboard shortcuts
            <button
              type="button"
              className="kbd-help-close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </header>
          <ul className="kbd-help-list">
            {ROWS.map((r) => (
              <li key={r.keys} className="kbd-help-row">
                <kbd>{r.keys}</kbd>
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
