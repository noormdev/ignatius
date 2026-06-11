import type { ProcessUsage } from '../../../flows/flow-usage-index';

export function ProcessesTable({ usages, onScrollToProcess }: {
  usages: ProcessUsage[];
  onScrollToProcess: (processId: string) => void;
}) {
  return (
    <div className="dict-processes-table-wrap">
      <h4 className="dict-section-heading">Processes</h4>
      <table className="dict-processes-table">
        <thead>
          <tr>
            <th>Process</th>
            <th>DFD</th>
            <th>Direction</th>
          </tr>
        </thead>
        <tbody>
          {usages.map(u => (
            <tr key={u.processId}>
              <td>
                <a
                  href={`#process-${u.processId}`}
                  onClick={e => { e.preventDefault(); onScrollToProcess(u.processId); }}
                >
                  {u.dottedNumber} {u.processLabel}
                </a>
              </td>
              <td>{u.dfdTitle}</td>
              <td>
                <span className={`dict-process-direction dict-process-direction--${u.direction}`}>
                  {u.direction}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
