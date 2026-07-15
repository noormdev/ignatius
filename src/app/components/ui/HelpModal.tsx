import { Modal } from './Modal';
import type { ViewName } from '../../hash-router';

/**
 * HelpModal — a view-aware orientation overlay. Answers "what am I looking at?"
 * for whichever view is active: the entity graph, the data dictionary, or the
 * process-flow diagrams. Deliberately brief — one line per concept, no walls of
 * text. The symbol-level reference lives in the separate LegendModal; this is the
 * conceptual map a first-time viewer needs.
 *
 * Opened by the top-bar (?) button and by the `?` key (see shortcuts.ts).
 */

type Row = { term: string; desc: string };

function HelpSection({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="help-section">
      <h2 className="help-section-title">{title}</h2>
      {rows.map((r) => (
        <div key={r.term} className="help-row">
          <strong className="help-term">{r.term}</strong>
          <span className="help-desc">{r.desc}</span>
        </div>
      ))}
    </section>
  );
}

const GRAPH_TYPES: Row[] = [
  { term: 'Independent', desc: 'Stands on its own — its primary key is all its own, no parent required.' },
  { term: 'Dependent', desc: "Identity depends on a parent: the parent's key lives inside its primary key." },
  { term: 'Subtype', desc: 'A specialization of a parent — e.g. Person and Business are subtypes of Party.' },
  { term: 'Associative', desc: 'A link table joining two entities — models a many-to-many relationship.' },
  { term: 'Classifier', desc: 'A small lookup table of types, statuses, or codes.' },
];

const GRAPH_EXPLORE: Row[] = [
  { term: 'Layouts', desc: 'Organic clusters related entities by force; Hierarchical stacks them in dependency layers. Toggle with L.' },
  { term: 'Shift + hover', desc: 'Reveals dotted lines to an entity’s whole key-inheritance family — every relative that shares its primary key, however far apart.' },
  { term: 'Click · drag · zoom', desc: 'Click an entity for full detail; drag to rearrange (positions are saved); scroll or ⌘/Ctrl +/−/0 to zoom.' },
  { term: 'Search', desc: 'Type to highlight matches and dim the rest; flip Include descriptions to also match markdown text; Enter cycles through matches.' },
];

const GRAPH_STYLES: Row[] = [
  { term: 'Key-inherited', desc: "A child’s primary key contains its parent’s key, so identity flows down the relationships — this is what the Shift lineage traces." },
  { term: 'Surrogate (ORM)', desc: 'Every table has its own id and foreign keys sit in ordinary columns — no inherited lineage to show.' },
];

const DICT_LENSES: Row[] = [
  { term: 'Read lens', desc: 'Every entity and process in full detail, grouped by domain. Scroll or search.' },
  { term: 'Browse lens', desc: 'A compact card grid with a spotlight. Toggle lenses with B.' },
];

const DICT_EXPLORE: Row[] = [
  { term: 'Spotlight', desc: 'Hover or pin a card to light up its relationships — solid lines to foreign-key neighbors, dashed lines to process flows.' },
  { term: 'Shift + hover', desc: 'Adds dotted key-inheritance lineage lines: the family of cards that share the active card’s primary key.' },
  { term: 'Search · focus', desc: 'The search bar filters and highlights across all cards; Focus neighborhood isolates a card and its relatives.' },
];

const FLOW_SYMBOLS: Row[] = [
  { term: 'Process', desc: 'A numbered transformation that takes inputs and produces outputs.' },
  { term: 'Data store', desc: 'An open-ended box holding data at rest. A db: store maps to one of your entities.' },
  { term: 'External', desc: 'A source or sink of data outside the system boundary (green).' },
];

const FLOW_EXPLORE: Row[] = [
  { term: 'Levels & drill-down', desc: 'Numbered processes decompose — click one to drill into its sub-diagram; breadcrumbs walk back up. The context and overview levels are derived automatically.' },
  { term: 'Inspect', desc: 'Hover a connector to see the exact data items it carries; the ⓘ badge on any node opens its details (a db: store opens the full entity).' },
  { term: 'Search', desc: 'Type to find matches across every diagram, including sub-DFDs — flip Include descriptions to also match markdown text; results list by diagram, click one to navigate there. Non-matches dim in the diagram.' },
];

function shortcutRows(view: ViewName): Row[] {
  const rows: Row[] = [{ term: 'G · D · F', desc: 'Switch between Graph, Dictionary, and Flows.' }];
  if (view === 'graph') rows.push({ term: 'L', desc: 'Toggle the graph layout (Organic / Hierarchical).' });
  if (view === 'dict') rows.push({ term: 'B', desc: 'Toggle the dictionary lens (Read / Browse).' });
  if (view === 'graph' || view === 'dict') {
    rows.push({ term: 'Shift + hover', desc: 'Reveal key-inheritance lineage.' });
  }
  if (view === 'graph' || view === 'flow') {
    rows.push({ term: '⌘/Ctrl +/−/0', desc: 'Zoom the canvas in, out, or reset.' });
    rows.push({ term: '← ↑ ↓ →', desc: 'Scroll the canvas; hold Shift to scroll faster.' });
  }
  rows.push({ term: '/ · ⌘/Ctrl K', desc: 'Focus the search bar.' });
  rows.push({ term: '?', desc: 'Open this help.' });
  return rows;
}

const TITLES: Record<ViewName, string> = {
  graph: 'About the Graph',
  dict: 'About the Dictionary',
  flow: 'About the Flows',
};

export function HelpModal({ view, onClose }: { view: ViewName; onClose: () => void }) {
  return (
    <Modal title={TITLES[view]} onClose={onClose} className="help-modal">
      <p className="help-intro">
        Ignatius visualizes your data model. <strong>Graph</strong> shows entities and how
        they relate, <strong>Dictionary</strong> is a searchable catalog, and{' '}
        <strong>Flows</strong> shows how data moves through processes. Switch any time with{' '}
        <kbd>G</kbd> <kbd>D</kbd> <kbd>F</kbd>.
      </p>

      {view === 'graph' && (
        <>
          <HelpSection title="What you're looking at" rows={[{ term: 'Entity-relationship diagram', desc: 'Each box is an entity (a table); each line is a foreign-key relationship.' }]} />
          <HelpSection title="Entity types" rows={GRAPH_TYPES} />
          <HelpSection title="How to explore" rows={GRAPH_EXPLORE} />
          <HelpSection title="Two modeling styles" rows={GRAPH_STYLES} />
        </>
      )}

      {view === 'dict' && (
        <>
          <HelpSection title="What you're looking at" rows={DICT_LENSES} />
          <HelpSection title="How to explore" rows={DICT_EXPLORE} />
        </>
      )}

      {view === 'flow' && (
        <>
          <HelpSection title="What you're looking at" rows={[{ term: 'Data flow diagram', desc: 'Gane-Sarson notation showing how data moves through your system — not the database structure (that’s the Graph).' }]} />
          <HelpSection title="Symbols" rows={FLOW_SYMBOLS} />
          <HelpSection title="How to explore" rows={FLOW_EXPLORE} />
        </>
      )}

      <HelpSection title="Keyboard" rows={shortcutRows(view)} />

      {(view === 'graph' || view === 'flow') && (
        <p className="help-footnote">
          For the exact symbols, open <strong>Legend</strong> from the menu.
        </p>
      )}
    </Modal>
  );
}
