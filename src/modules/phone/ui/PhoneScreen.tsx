import { useState } from 'react';
import { listTeamMembers, useAsync, useSession } from '@/core';
import { getFlow, getSettings, listTeamPhones } from '../service';
import { Calls } from './Calls';
import { CallScreen } from './CallScreen';
import { CallTree, type Person } from './CallTree';
import { HoursPeople } from './HoursPeople';

type Tab = 'tree' | 'setup' | 'calls' | 'screen';

/** The phone: the call tree that answers calls, the number/hours/people it uses, and a list of calls and voicemails. */
export default function PhoneScreen() {
  const { companyId, companyName, role } = useSession();
  const [tab, setTab] = useState<Tab>('screen');
  const canEdit = role === 'owner' || role === 'admin';
  const { data, loading, error, reload } = useAsync(
    async () => ({ flow: await getFlow(companyId), settings: await getSettings(companyId), phones: await listTeamPhones(companyId), team: await listTeamMembers() }),
    [companyId],
  );
  if (loading) return <p className="muted">Loading…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not load the phone.'}</p>;

  const people: Person[] = data.team.map((m) => ({ id: m.id, name: m.full_name || m.email || 'Team member', phone: data.phones[m.id] ?? '' }));
  const tabs: [Tab, string][] = canEdit ? [['screen', 'Call screen'], ['tree', 'Call tree'], ['setup', 'Number, hours & people'], ['calls', 'Calls & voicemails']] : [['screen', 'Call screen'], ['calls', 'Calls & voicemails']];
  const current = canEdit || tab === 'calls' ? tab : 'screen';

  return (
    <div>
      <h1>Phone</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" className={current === id ? '' : 'secondary'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {current === 'tree' && <CallTree flow={data.flow.graph} saved={data.flow.saved} people={people} companyName={companyName} />}
      {current === 'setup' && <HoursPeople settings={data.settings} people={people} onSaved={reload} />}
      {current === 'screen' && <CallScreen script={data.settings.script} />}
      {current === 'calls' && <Calls />}
    </div>
  );
}
