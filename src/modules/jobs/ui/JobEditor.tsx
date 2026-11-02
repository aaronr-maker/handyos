import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fromDateTimeLocal, resultError, useAction } from '@/core';
import { CustomerPropertyPicker, type WhoValue } from '@/modules/customers';
import { createJobAction } from '../actions';
import { useTeam } from './useTeam';

export default function JobEditor() {
  const navigate = useNavigate();
  const create = useAction(createJobAction);
  const { members } = useTeam();
  const [who, setWho] = useState<WhoValue>({ customerId: '', propertyId: '' });
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    const res = await create({
      customer_id: who.propertyId ? null : who.customerId || null,
      property_id: who.propertyId || null,
      title,
      notes: notes.trim() || null,
      scheduled_start: fromDateTimeLocal(start),
      scheduled_end: start ? fromDateTimeLocal(end) : null,
      assignee_ids: assignees,
      estimate_id: null,
    });
    const message = resultError(res);
    setBusy(false);
    if (message) setError(message);
    else if (res.status === 'ok') navigate(`/jobs/${(res.output as { id: string }).id}`);
  };

  return (
    <section className="page">
      <Link to="/jobs" className="muted">
        ← Jobs
      </Link>
      <header className="page-header">
        <h1>New job</h1>
      </header>
      <div className="card">
        <h2>Who is it for?</h2>
        <CustomerPropertyPicker value={who} onChange={setWho} />
      </div>
      <div className="card">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix fence gate" />
        </label>
        <label>
          Notes <span className="muted">(optional, for the crew)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="row">
          <label className="grow">
            Start <span className="muted">(optional)</span>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="grow">
            End
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!start} />
          </label>
        </div>
        {members.length > 0 && (
          <fieldset>
            <legend>Assign to</legend>
            {members.map((m) => (
              <label key={m.id} className="check">
                <input
                  type="checkbox"
                  checked={assignees.includes(m.id)}
                  onChange={(e) => setAssignees(e.target.checked ? [...assignees, m.id] : assignees.filter((x) => x !== m.id))}
                />
                {m.full_name || m.email}
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="err">{error}</p>}
        <button disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Create job'}
        </button>
      </div>
    </section>
  );
}
