import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/core';
import { P4PSettings } from '@/modules/jobcosting';

type Section = 'p4p';

/** Company settings. Each section is owned by the module it configures. */
export function SettingsScreen() {
  const { role, companyName } = useSession();
  const [section, setSection] = useState<Section>('p4p');
  if (role !== 'owner' && role !== 'admin') {
    return (
      <section className="page">
        <h1>Settings</h1>
        <p className="muted">Only the owner and admins can change company settings.</p>
      </section>
    );
  }
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">{companyName}</p>
        </div>
      </header>
      <div className="row">
        <button className={section === 'p4p' ? '' : 'secondary'} onClick={() => setSection('p4p')}>
          Pay-for-performance
        </button>
        <Link to="/handy" className="button secondary">
          Handy usage &amp; options
        </Link>
      </div>
      {section === 'p4p' && <P4PSettings />}
    </section>
  );
}
