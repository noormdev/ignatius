import { Fragment } from 'react';
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

/** A key name, a set of interchangeable keys (`+ / − / 0`), or plain words such as "hover". */
type KeyPart = string | string[] | { text: string };
/** Keys pressed together. */
type Chord = KeyPart[];
/** Chords that do the same thing, shown separated by `·`. */
type ShortcutRow = { keys: Chord[]; desc: string };

const MOD = '⌘/Ctrl';
const HOVER = { text: 'hover' };

function KeyPartView({ part }: { part: KeyPart }) {
  if (typeof part === 'string') return <kbd>{part}</kbd>;
  if (!Array.isArray(part)) return <span>{part.text}</span>;
  return (
    <>
      {part.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && <span className="help-keys-sep">/</span>}
          <kbd>{key}</kbd>
        </Fragment>
      ))}
    </>
  );
}

function Keys({ chords }: { chords: Chord[] }) {
  return (
    <span className="help-term help-keys">
      {chords.map((chord, c) => (
        <Fragment key={c}>
          {c > 0 && <span className="help-keys-sep">·</span>}
          {chord.map((part, p) => (
            <Fragment key={p}>
              {p > 0 && <span>+</span>}
              <KeyPartView part={part} />
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

function ShortcutSection({ rows }: { rows: ShortcutRow[] }) {
  return (
    <section className="help-section">
      <h2 className="help-section-title">Keyboard</h2>
      {rows.map((r) => (
        <div key={r.desc} className="help-row">
          <Keys chords={r.keys} />
          <span className="help-desc">{r.desc}</span>
        </div>
      ))}
    </section>
  );
}

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
  { term: 'Layouts', desc: 'Organic clusters related entities by force; Hierarchical gives each colour group its own block, stacked in dependency layers; Tree lays the model out as an outline, each table below and right of the table whose key it inherits, with right-angled lines. A first visit opens in Tree; L steps through them, Shift+L steps back, and the choice is kept.' },
  { term: 'Shift + hover', desc: 'Reveals dotted lines to an entity’s whole key-inheritance family — every relative that shares its primary key, however far apart.' },
  { term: 'Click · drag · zoom', desc: 'Click an entity for full detail; drag to rearrange (positions are saved, and survive edits to the model); scroll or ⌘/Ctrl +/−/0 to zoom.' },
  { term: 'Move several', desc: 'Shift+drag on the background draws a selection box; press S for select mode, where a plain drag boxes and a click adds or removes. Drag any selected entity to move them all.' },
  { term: 'Undo', desc: '⌘/Ctrl Z takes back a move, a hide, or a layout change; ⌘/Ctrl Shift Z redoes it. The undo and redo arrows above the zoom control do the same.' },
  { term: 'Hide', desc: 'Right-click an entity, or press H with entities selected, to take it out of the view; Shift+H hides every entity in the selected entities’ groups, and Groups in the menu hides or shows a whole group. The crossed-out eye above the zoom control counts and lists them to bring back; Reset layout lays out without them.' },
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
  { term: 'Levels & drill-down', desc: 'Numbered processes decompose — click one to drill into its sub-diagram; breadcrumbs walk back up, and the house button returns to the overview of every flow.' },
  { term: 'Flow index', desc: 'Click Process Flows (or press I) for the whole process hierarchy; hover a row to read its description, click it to open that diagram.' },
  { term: 'Switch levels', desc: 'A ▾ on a breadcrumb lists the other diagrams at that level, with descriptions — pick one to jump sideways.' },
  { term: 'Inspect', desc: 'Hover a connector to see the exact data items it carries; the ⓘ badge on any node opens its details (a db: store opens the full entity).' },
  { term: 'Search', desc: 'Type to find matches across every diagram, including sub-DFDs — flip Include descriptions to also match markdown text; results list by diagram, click one to navigate there. Non-matches dim in the diagram.' },
];

function shortcutRows(view: ViewName): ShortcutRow[] {
  const rows: ShortcutRow[] = [{ keys: [['G'], ['D'], ['F']], desc: 'Switch between Graph, Dictionary, and Flows.' }];
  if (view === 'graph') {
    rows.push({ keys: [['L']], desc: 'Step through the graph layouts (Organic → Hierarchical → Tree).' });
    rows.push({ keys: [['Shift', 'L']], desc: 'Step back to the previous layout.' });
    rows.push({ keys: [['R']], desc: 'Reset the layout.' });
    rows.push({ keys: [['S']], desc: 'Toggle select mode.' });
    rows.push({ keys: [['H']], desc: 'Hide the selected entities.' });
    rows.push({ keys: [['Shift', 'H']], desc: 'Hide every entity in the selected entities’ groups.' });
    rows.push({ keys: [[MOD, 'Z']], desc: 'Undo a move, hide, or layout change.' });
    rows.push({ keys: [[MOD, 'Shift', 'Z']], desc: 'Redo it.' });
  }
  if (view === 'dict') rows.push({ keys: [['B']], desc: 'Toggle the dictionary lens (Read / Browse).' });
  if (view === 'flow') {
    rows.push({ keys: [['I']], desc: 'Open or close the flow index.' });
    rows.push({ keys: [['L'], ['Shift', 'L']], desc: 'Switch between the per-process and connected views.' });
    rows.push({ keys: [['R']], desc: 'Reset the layout.' });
  }
  if (view === 'graph' || view === 'dict') {
    rows.push({ keys: [['Shift', HOVER]], desc: 'Reveal key-inheritance lineage.' });
  }
  if (view === 'graph' || view === 'flow') {
    rows.push({ keys: [[MOD, ['+', '−', '0']]], desc: 'Zoom the canvas in, out, or reset.' });
    rows.push({ keys: [[['←', '↑', '↓', '→']]], desc: 'Scroll the canvas; hold Shift to scroll faster.' });
  }
  rows.push({ keys: [[MOD, 'C']], desc: 'Copy a link to this view (when no text is selected).' });
  rows.push({ keys: [['/'], [MOD, 'K']], desc: 'Focus the search bar.' });
  rows.push({ keys: [['?']], desc: 'Open this help.' });
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

      <ShortcutSection rows={shortcutRows(view)} />

      {(view === 'graph' || view === 'flow') && (
        <p className="help-footnote">
          For the exact symbols, open <strong>Legend</strong> from the menu.
        </p>
      )}
    </Modal>
  );
}
