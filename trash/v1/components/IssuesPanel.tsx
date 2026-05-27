import type { Issue } from '../engine';

interface Props {
  issues: Issue[];
}

export function IssuesPanel({ issues }: Props) {
  if (issues.length === 0) return <div className="issues empty" />;
  const errors = issues.filter(i => i.severity === 'error');
  const cls = errors.length > 0 ? 'issues' : 'issues warn';
  const heading = errors.length > 0
    ? `${errors.length} error${errors.length > 1 ? 's' : ''}`
    : `${issues.length} warning${issues.length > 1 ? 's' : ''}`;

  return (
    <div className={cls}>
      <h4>{heading}</h4>
      <ul>
        {issues.map((i, idx) => (
          <li key={idx}>
            <span>[{i.phase}] {i.message}</span>
            {i.location && <span className="loc">{i.location}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
