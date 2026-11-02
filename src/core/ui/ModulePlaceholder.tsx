import { Icon, type IconName } from './icons';

interface Props {
  title: string;
  icon: IconName;
  summary: string;
  planned: string[];
}

/** Shared placeholder screen shown by modules until their real UI is built. */
export function ModulePlaceholder({ title, icon, summary, planned }: Props) {
  return (
    <section className="page">
      <header className="page-header">
        <span className="page-icon">
          <Icon name={icon} width={26} height={26} />
        </span>
        <div>
          <h1>{title}</h1>
          <p className="muted">{summary}</p>
        </div>
      </header>
      <div className="card">
        <h2>Coming soon</h2>
        <ul className="checklist">
          {planned.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
