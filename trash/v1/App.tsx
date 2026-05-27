import { useEffect, useRef, useState } from 'react';
import { YamlEditor } from './components/YamlEditor';
import { GraphView } from './components/GraphView';
import { IssuesPanel } from './components/IssuesPanel';
import { run, type EngineResult } from './engine';
import sampleYaml from './samples/sample_model.yaml' with { type: 'text' };

const STORAGE_KEY = 'derek-db-generator:yaml';
const DEBOUNCE_MS = 300;

const EMPTY_RESULT: EngineResult = { ok: false, issues: [] };

export function App() {
  const [yamlText, setYamlText] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ?? sampleYaml;
    } catch {
      return sampleYaml;
    }
  });

  const [result, setResult] = useState<EngineResult>(EMPTY_RESULT);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSeq = useRef(0);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      try { localStorage.setItem(STORAGE_KEY, yamlText); } catch {}
      const seq = ++runSeq.current;
      try {
        const r = await run(yamlText);
        if (seq === runSeq.current) setResult(r);
      } catch (e) {
        if (seq === runSeq.current) {
          setResult({
            ok: false,
            issues: [{
              severity: 'error',
              phase: 'parse',
              message: `Engine crashed: ${(e as Error).message}`,
            }],
          });
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [yamlText]);

  const reset = () => {
    setYamlText(sampleYaml);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  const stats = result.model
    ? `${result.model.nodes.size} entities · ${result.model.edges.length} edges · ${result.model.subtypeClusters.length} clusters`
    : '—';

  return (
    <div className="app">
      <div className="toolbar">
        <span className="title">Derek DB Generator</span>
        <button onClick={reset}>Reset to sample</button>
        <span className="stats">{stats}</span>
      </div>
      <div className="editor-pane">
        <YamlEditor value={yamlText} onChange={setYamlText} />
      </div>
      <div className="graph-pane">
        <GraphView result={result} />
        <IssuesPanel issues={result.issues} />
      </div>
    </div>
  );
}
