import type { ChangeMark, ChangeSeverity } from '../../logic/change-marks';

export function ChangeBadge({ mark }: { mark: ChangeMark | undefined }) {
  if (!mark) return null;
  return (
    <span
      className={`change-badge change-badge--${mark.change}${mark.unexplained ? ' change-badge--unexplained' : ''}`}
      title={mark.unexplained ? 'Not covered by a change note' : undefined}
    >
      {mark.change}{mark.unexplained ? ' · unexplained' : ''}
    </span>
  );
}

/** A static dot colored by the worst change inside a flow index or level menu row's diagram,
 *  or, given the row's own `mark`, a dot that pulses in its kind color. */
export function ChangeDot({ severity, mark = null }: { severity: ChangeSeverity | null; mark?: ChangeMark | null }) {
  if (mark) {
    const label = `${mark.change === 'added' ? 'Added' : 'Changed'}${mark.unexplained ? ', not covered by a change note' : ''}`;
    return (
      <span
        className="change-dot change-dot--pulse"
        data-ignatius="flow-change-dot"
        data-change={mark.change}
        data-unexplained={mark.unexplained ? 'true' : undefined}
        role="img"
        aria-label={label}
        title={label}
      />
    );
  }
  if (!severity) return null;
  const label = severity === 'unexplained' ? 'Contains changes no note covers' : 'Contains changes';
  return (
    <span
      className={`change-dot change-dot--${severity}`}
      data-ignatius="flow-change-dot"
      data-severity={severity}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
