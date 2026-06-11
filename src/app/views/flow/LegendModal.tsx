import { Modal } from '../../components/ui/Modal';
import { resolveFlowKindPalette, type ThemeMode, type FlowKindKey, type FlowKindEntry } from '../../../theme/theme-defaults';
import { DARK_PALETTE, LIGHT_PALETTE } from '../../../flow-view/FlowDiagramSvg';
import type { FlowPalette } from '../../../flow-view/FlowDiagramSvg';
import type { ViewName } from '../../hash-router';

// The graph viewer renders IDEF1X notation: entity identity by corner shape,
// relationship dependency by line style, cardinality by crow's-foot end markers,
// and subtype completeness by the discriminator diamond. The legend reproduces
// each symbol with the same theme CSS vars the graph uses so it tracks the active
// palette. Geometry mirrors src/app/views/graph/markers.ts (bars, hollow circle, fanning prongs).
// When view === 'flow', renders the DFD node-kind legend using the themed FlowPalette.
export function LegendModal({ onClose, view, themeMode, kindPalette }: {
  onClose: () => void;
  view: ViewName;
  themeMode: ThemeMode;
  kindPalette?: Record<FlowKindKey, FlowKindEntry>;
}) {
  const identifying = 'var(--color-edge-identifying)';
  const referential = 'var(--color-edge-referential)';

  if (view === 'flow') {
    const p: FlowPalette = themeMode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
    const kp = kindPalette ?? resolveFlowKindPalette(themeMode);

    // Per-kind store entries for the legend.
    const kindRows: Array<{ key: FlowKindKey; label: string; desc: string }> = [
      { key: 'db',     label: 'DB store',     desc: 'Data entity backed by a relational table (db:).' },
      { key: 'cache',  label: 'Cache',        desc: 'In-memory or distributed key-value cache.' },
      { key: 'queue',  label: 'Queue',        desc: 'Message queue or event bus.' },
      { key: 'file',   label: 'File store',   desc: 'Flat file, log, or blob storage.' },
      { key: 'doc',    label: 'Document',     desc: 'Document store (JSON/XML).' },
      { key: 'manual', label: 'Manual store', desc: 'Physical or human-operated store.' },
      { key: 'other',  label: 'Other store',  desc: 'Any store kind not covered above.' },
    ];

    return (
      <Modal title="Legend" onClose={onClose} className="legend-modal">
        <section className="legend-section">
          <h2 className="legend-section-title">Node kinds</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity" style={{ background: p.procFill, borderColor: p.procBorder, borderWidth: 2, borderStyle: 'solid', borderRadius: 6 }} />
            </span>
            <span className="legend-text">
              <strong className="legend-term">Process</strong>
              <span className="legend-desc">A numbered transformation that receives inputs and produces outputs.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity" style={{ background: kp.external.bg, borderColor: kp.external.border, borderWidth: 2, borderStyle: 'solid', borderRadius: 2 }} />
            </span>
            <span className="legend-text">
              <strong className="legend-term">External entity</strong>
              <span className="legend-desc">A source or sink of data that lies outside the system boundary.</span>
            </span>
          </div>
        </section>
        <section className="legend-section">
          <h2 className="legend-section-title">Data store kinds</h2>
          {kindRows.map(({ key, label, desc }) => (
            <div key={key} className="legend-row">
              <span className="legend-symbol">
                <span className="legend-entity" style={{ background: kp[key].bg, borderColor: kp[key].border, borderWidth: 2, borderStyle: 'solid', borderTopLeftRadius: 2, borderBottomLeftRadius: 2, borderTopRightRadius: 0, borderBottomRightRadius: 0 }} />
              </span>
              <span className="legend-text">
                <strong className="legend-term">{label}</strong>
                <span className="legend-desc">{desc}</span>
              </span>
            </div>
          ))}
        </section>
      </Modal>
    );
  }

  return (
    <Modal title="Legend" onClose={onClose} className="legend-modal">
        <section className="legend-section">
          <h2 className="legend-section-title">Entities</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity legend-entity--independent" />
            </span>
            <span className="legend-text">
              <strong className="legend-term">Independent entity</strong>
              <span className="legend-desc">Sharp corners. Identified by its own attributes — its primary key holds no foreign keys.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <span className="legend-entity legend-entity--dependent" />
            </span>
            <span className="legend-text">
              <strong className="legend-term">Dependent entity</strong>
              <span className="legend-desc">Rounded corners. Its identity depends on a parent — the primary key inherits a foreign key.</span>
            </span>
          </div>
        </section>

        <section className="legend-section">
          <h2 className="legend-section-title">Relationships</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="60" height="20" viewBox="0 0 60 20">
                <line x1="2" y1="10" x2="58" y2="10" stroke={identifying} strokeWidth="2" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Identifying</strong>
              <span className="legend-desc">Solid line. The parent key migrates into the child's primary key — the child cannot exist without the parent.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="60" height="20" viewBox="0 0 60 20">
                <line x1="2" y1="10" x2="58" y2="10" stroke={referential} strokeWidth="1.4" strokeDasharray="5 4" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Non-identifying</strong>
              <span className="legend-desc">Dashed line. The parent key migrates into a non-key column — a plain reference.</span>
            </span>
          </div>
        </section>

        <section className="legend-section">
          <h2 className="legend-section-title">Cardinality</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="24" viewBox="0 0 64 24">
                <line x1="2" y1="12" x2="40" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="40" y1="2" x2="40" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="47" y1="2" x2="47" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Exactly one</strong>
              <span className="legend-desc">Two bars. Mandatory and singular — one and only one.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="24" viewBox="0 0 64 24">
                <line x1="2" y1="12" x2="36" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="36" y1="2" x2="36" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="49" cy="12" r="6" fill="var(--color-background)" stroke={identifying} strokeWidth="1.8" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Zero or one</strong>
              <span className="legend-desc">Bar and hollow circle. Optional and singular — at most one.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="24" viewBox="0 0 64 24">
                <line x1="2" y1="12" x2="34" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="34" y1="12" x2="54" y2="2" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="34" y1="12" x2="54" y2="12" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="34" y1="12" x2="54" y2="22" stroke={identifying} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Many</strong>
              <span className="legend-desc">Crow's foot. Many on this end — zero or more.</span>
            </span>
          </div>
        </section>

        <section className="legend-section">
          <h2 className="legend-section-title">Subtypes</h2>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="28" viewBox="0 0 64 28">
                <line x1="2" y1="14" x2="20" y2="14" stroke={identifying} strokeWidth="1.5" />
                <polygon points="32,4 44,14 32,24 20,14" fill="var(--color-background)" stroke={identifying} strokeWidth="2" />
                <line x1="44" y1="14" x2="62" y2="14" stroke={identifying} strokeWidth="1.5" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Inclusive subtype</strong>
              <span className="legend-desc">Plain diamond. A supertype row may belong to several subtypes — categories can overlap.</span>
            </span>
          </div>
          <div className="legend-row">
            <span className="legend-symbol">
              <svg width="64" height="28" viewBox="0 0 64 28">
                <line x1="2" y1="14" x2="20" y2="14" stroke={identifying} strokeWidth="1.5" />
                <polygon points="32,4 44,14 32,24 20,14" fill="var(--color-background)" stroke={identifying} strokeWidth="2" />
                <text x="32" y="14" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill={identifying}>X</text>
                <line x1="44" y1="14" x2="62" y2="14" stroke={identifying} strokeWidth="1.5" />
              </svg>
            </span>
            <span className="legend-text">
              <strong className="legend-term">Exclusive subtype</strong>
              <span className="legend-desc">Diamond marked X. Each supertype row is exactly one of the subtypes — categories are mutually exclusive.</span>
            </span>
          </div>
        </section>
    </Modal>
  );
}
