import { fromLocalInput, toLocalInput } from './fmt';

/** One start and end time, editable when allowed (greyed out otherwise), with "edited by" when it was changed. */
export function Punch({ start, end, canEdit, editedBy, onChange }: { start: string; end: string | null; canEdit: boolean; editedBy: { initials: string; who: string; count: number } | null; onChange(patch: { start?: string; end?: string | null }): void }) {
  return (
    <div className="row" style={{ alignItems: 'center', gap: 8, opacity: canEdit ? 1 : 0.5, flexWrap: 'wrap' }}>
      <input
        type="datetime-local"
        aria-label="Start"
        disabled={!canEdit}
        defaultValue={toLocalInput(start)}
        onBlur={(e) => e.target.value && fromLocalInput(e.target.value) !== new Date(start).toISOString() && onChange({ start: fromLocalInput(e.target.value) })}
      />
      <span>to</span>
      <input
        type="datetime-local"
        aria-label="End"
        disabled={!canEdit}
        defaultValue={toLocalInput(end)}
        onBlur={(e) => e.target.value && (!end || fromLocalInput(e.target.value) !== new Date(end).toISOString()) && onChange({ end: fromLocalInput(e.target.value) })}
      />
      {end === null && <span className="muted small-note">still running</span>}
      {editedBy && (
        <span className="muted small-note" title={`Changed ${editedBy.count} time${editedBy.count === 1 ? '' : 's'}; last by ${editedBy.who}`}>
          edited by {editedBy.initials}
        </span>
      )}
    </div>
  );
}
