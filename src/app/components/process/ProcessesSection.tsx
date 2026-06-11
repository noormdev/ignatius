import type { ProcessUsage } from '../../../flows/flow-usage-index';

export function ProcessesSection({ usages, onNavigateToProcess }: {
  usages: ProcessUsage[];
  onNavigateToProcess: (processId: string) => void;
}) {
  return (
    <div className="modal-processes doc-section">
      <h4>Processes</h4>
      <div className="table-scroll">
        <table>
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
                    onClick={e => { e.preventDefault(); onNavigateToProcess(u.processId); }}
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
    </div>
  );
}
