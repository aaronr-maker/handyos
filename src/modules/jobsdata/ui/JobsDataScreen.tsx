import { useState } from 'react';
import { useSession } from '@/core';
import { RevenueByPeriod } from '@/modules/revenue';
import { ImportReports } from './ImportReports';
import { Overview } from './Overview';

type Tab = 'overview' | 'period' | 'import';

/** The numbers behind your jobs: an overview of the KPIs, revenue over time, and where the history comes from. */
export default function JobsDataScreen() {
  const { role } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  if (role !== 'owner' && role !== 'admin') return <p className="muted">Only the owner and admins can see jobs data.</p>;
  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['period', 'Revenue by period'],
    ['import', 'Import reports'],
  ];
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Jobs data</h1>
          <p className="muted">Revenue, profit and the numbers behind your jobs.</p>
        </div>
      </header>
      <div className="seg" role="group" aria-label="Jobs data">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? '' : 'secondary'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview onImport={() => setTab('import')} />}
      {tab === 'period' && <RevenueByPeriod />}
      {tab === 'import' && <ImportReports />}
    </section>
  );
}
