import { useId } from 'react';
import { Modal } from './Modal';
import { useSettings } from '../../hooks/useSettings';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, update] = useSettings();
  const examplesHintId = useId();

  return (
    <Modal title="Settings" onClose={onClose} className="settings-modal">
      <div className="settings-row">
        <label className="legend-term settings-option">
          <input
            type="checkbox"
            checked={settings.alwaysOpenExamples}
            onChange={e => update({ alwaysOpenExamples: e.target.checked })}
            aria-describedby={examplesHintId}
          />
          Always open examples
        </label>
        <p className="legend-desc settings-hint" id={examplesHintId}>
          Expand every example table, not only those with 3 rows or fewer.
        </p>
      </div>
    </Modal>
  );
}
