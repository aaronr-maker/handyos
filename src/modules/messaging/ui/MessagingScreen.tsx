import { Link } from 'react-router-dom';
import { useAsync, useSession } from '@/core';
import { customerLabel, listCustomers } from '@/modules/customers';
import { listAllMessages } from '../services/messageService';

const STATUS = { queued: 'Waiting to send', sent: 'Sent', failed: 'Failed' } as const;

/** Messages to and from customers. */
export default function MessagingScreen() {
  const { companyId } = useSession();
  const { data, loading, error } = useAsync(async () => ({ messages: await listAllMessages(companyId), customers: await listCustomers(companyId) }), [companyId]);
  const nameOf = (id: string) => {
    const c = data?.customers.find((x) => x.id === id);
    return c ? customerLabel(c) : 'Customer';
  };
  const queued = data?.messages.filter((m) => m.status === 'queued').length ?? 0;
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Messages</h1>
          <p className="muted">Texts and emails to customers, kept with each customer. Ask Handy to draft one: he shows it to you first and only saves it once you say so.</p>
        </div>
      </header>
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {queued > 0 && <p className="notice">{queued} message{queued === 1 ? ' is' : 's are'} saved but not sent yet. Texts and emails go out once a sending service is connected.</p>}
      <div className="card list">
        {data && data.messages.length === 0 && <p className="muted">No messages yet.</p>}
        {data?.messages.map((m) => (
          <div key={m.id} className="stack">
            <strong>
              {m.direction === 'outbound' ? 'To' : 'From'} <Link to={`/customers/${m.customer_id}`}>{nameOf(m.customer_id)}</Link> · {m.channel === 'sms' ? 'text' : 'email'}
            </strong>
            <span>{m.body}</span>
            <span className="muted small-note">
              {new Date(m.created_at).toLocaleString()} · {STATUS[m.status]}
              {m.error ? `: ${m.error}` : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
