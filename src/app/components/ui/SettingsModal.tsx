import { useId } from 'react';
import { Modal } from './Modal';
import { useSettings } from '../../hooks/useSettings';
import type { ThemeMode } from '../../../theme/theme-defaults';

const THEMES: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Light', icon: '☀' },
  { mode: 'dark', label: 'Dark', icon: '☾' },
];

export function SettingsModal({ themeMode, onSetTheme, onClose }: {
  themeMode: ThemeMode;
  onSetTheme: (mode: ThemeMode) => void;
  onClose: () => void;
}) {
  const [settings, update] = useSettings();
  const appearanceId = useId();
  const themeLabelId = useId();
  const contentId = useId();
  const examplesLabelId = useId();
  const examplesHintId = useId();

  return (
    <Modal title="Settings" onClose={onClose} className="settings-modal">
      <section className="settings-section" aria-labelledby={appearanceId}>
        <h2 className="settings-section-title" id={appearanceId}>Appearance</h2>
        <div className="settings-card">
          <div className="settings-item">
            <span className="settings-item-text">
              <span className="settings-item-label" id={themeLabelId}>Theme</span>
              <span className="settings-item-hint">Colors for every view and diagram.</span>
            </span>
            <div className="settings-segmented" role="radiogroup" aria-labelledby={themeLabelId}>
              {THEMES.map(({ mode, label, icon }) => (
                <label key={mode} className={`settings-segment${themeMode === mode ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="ignatius-theme"
                    value={mode}
                    checked={themeMode === mode}
                    onChange={() => onSetTheme(mode)}
                  />
                  <span aria-hidden="true">{icon}</span>
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby={contentId}>
        <h2 className="settings-section-title" id={contentId}>Content</h2>
        <div className="settings-card">
          <label className="settings-item">
            <span className="settings-item-text">
              <span className="settings-item-label" id={examplesLabelId}>Always open examples</span>
              <span className="settings-item-hint" id={examplesHintId}>
                Expand every example table, not only those with 3 rows or fewer.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="settings-switch"
              checked={settings.alwaysOpenExamples}
              onChange={e => update({ alwaysOpenExamples: e.target.checked })}
              aria-labelledby={examplesLabelId}
              aria-describedby={examplesHintId}
            />
          </label>
        </div>
      </section>
    </Modal>
  );
}
