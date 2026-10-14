import { useEffect, useRef, useState } from 'react';
import { validateModel } from '../../model/validate';
import type { EntityError, GlobalError } from '../../model/validate';
import type { Model, ModelNode } from '../../model/parse';
import type { FlowDiagram } from '../../flows/flow-parse';
import type { FlowCluster } from '../../flows/flow-clusters';
import type { FlowError, FlowValidationResult } from '../../flows/flow-validate';
// Type-only: change-review.ts imports flow-markdown at runtime, which pulls shiki into the bundle.
import type { ChangeReview } from '../../model/change-review';

export type ModelFindings = {
  globalErrors: GlobalError[];
  entityErrors: EntityError[];
};

export type FlowFindings = {
  flowErrors: FlowError[];
  globalErrors: GlobalError[];
};

export type UseModelDataOptions = {
  // Called after each SSE model-changed refetch with the refreshed cleaned model.
  // Shell uses this to update the selected entity state in-place.
  onSseRefresh?: (cleanedModel: Model) => void;
};

type ModelApiPayload = {
  model: Model;
  parseGlobalErrors: GlobalError[];
  validation: { cleanedModel: Model; globalErrors: GlobalError[]; entityErrors: EntityError[] };
  layoutKey?: string;
  diff: ChangeReview | null;
};

type FlowApiPayload = {
  diagrams: FlowDiagram[];
  flowLayoutKeys: Record<string, string>;
  entityModel?: Model;
  validation?: FlowValidationResult;
  clusters?: FlowCluster[];
};

async function doModelFetch(): Promise<ModelApiPayload> {
  const r = await fetch('/api/model');
  if (!r.ok) throw new Error(`/api/model returned ${r.status}`);
  return r.json();
}

async function doFlowFetch(): Promise<FlowApiPayload> {
  const r = await fetch('/api/flow');
  if (!r.ok) throw new Error(`/api/flow returned ${r.status}`);
  return r.json();
}

// Unified SSE subscription + model/flow fetch + findings state.
// In static mode: reads window.__MODEL__ / __FLOW_MODEL__ / __CHANGE_REVIEW__ once on mount.
// In live mode: boots with parallel /api/model + /api/flow, then re-fetches
// both on every 'model-changed' SSE event.
export function useModelData(opts?: UseModelDataOptions): {
  model: Model | null;
  findings: ModelFindings;
  flowDiagrams: FlowDiagram[] | null;
  flowClusters: FlowCluster[];
  flowFindings: FlowFindings;
  /** Changes since the last approval; null when there is no review: an export made without a baseline, or one the server could not build. */
  diff: ChangeReview | null;
  /** Refetches `/api/model` and replaces `diff` only. */
  refreshDiff: () => Promise<void>;
  layoutKeyRef: React.MutableRefObject<string>;
  bannerDismissed: boolean;
  setBannerDismissed: (v: boolean) => void;
} {
  const [model, setModel] = useState<Model | null>(null);
  const [findings, setFindings] = useState<ModelFindings>({
    globalErrors: [],
    entityErrors: [],
  });
  // null = not yet fetched; [] = fetch returned empty / static mode with no flows.
  const [flowDiagrams, setFlowDiagrams] = useState<FlowDiagram[] | null>(null);
  const [flowClusters, setFlowClusters] = useState<FlowCluster[]>([]);
  const [flowFindings, setFlowFindings] = useState<FlowFindings>({
    flowErrors: [],
    globalErrors: [],
  });
  const [diff, setDiff] = useState<ChangeReview | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const layoutKeyRef = useRef<string>('');

  // Keep a live ref to the callback so the SSE closure doesn't go stale.
  const onSseRefreshRef = useRef(opts?.onSseRefresh);
  onSseRefreshRef.current = opts?.onSseRefresh;

  useEffect(() => {
    // React StrictMode double-invokes this effect in dev (mount→cleanup→mount).
    // The boot fetch below has no way to cancel an in-flight request, so without
    // this flag the FIRST invocation's fetch still resolves after its own
    // cleanup ran and calls setFlowDiagrams/setModel anyway — a second,
    // reference-changed update lands shortly after the real one, retriggering
    // every effect keyed on `flowDiagrams`/`model` (including the flow
    // renderer's mount effect) while the first mount is still settling. This
    // is the documented React pattern for fetch-in-effect: a local flag set on
    // cleanup, checked before every setState in a `.then()`.
    let ignore = false;
    const mode = window.__IGNATIUS_MODE__;

    if (mode === 'static') {
      if (window.__MODEL__) {
        const rawModel = window.__MODEL__;
        const validation = validateModel(rawModel);
        setModel(validation.cleanedModel);
        setFindings({
          globalErrors: validation.globalErrors,
          entityErrors: validation.entityErrors,
        });
        layoutKeyRef.current = window.__LAYOUT_KEY__ ?? '';
      }
      const rawDiagrams = window.__FLOW_MODEL__;
      if (rawDiagrams && rawDiagrams.length > 0) setFlowDiagrams(rawDiagrams);
      if (window.__FLOW_CLUSTERS__) setFlowClusters(window.__FLOW_CLUSTERS__);
      setDiff(window.__CHANGE_REVIEW__ ?? null);
      return;
    }

    // ── Live mode ─────────────────────────────────────────────────────────────

    function applyModelPayload(payload: ModelApiPayload) {
      const allGlobal = [...payload.parseGlobalErrors, ...payload.validation.globalErrors];
      setModel(payload.validation.cleanedModel);
      setFindings({
        globalErrors: allGlobal,
        entityErrors: payload.validation.entityErrors,
      });
      layoutKeyRef.current = payload.layoutKey ?? '';
      setDiff(payload.diff);
    }

    function applyFlowPayload(payload: FlowApiPayload) {
      const { diagrams, flowLayoutKeys, entityModel, validation, clusters } = payload;
      if (diagrams && diagrams.length > 0) {
        window.__FLOW_MODEL__ = diagrams;
        window.__FLOW_LAYOUT_KEYS__ = flowLayoutKeys;
        if (entityModel) window.__MODEL__ = entityModel;
        setFlowDiagrams(diagrams);
      } else if (validation && (validation.flowErrors.length > 0 || validation.globalErrors.length > 0)) {
        window.__FLOW_MODEL__ = [];
        window.__FLOW_LAYOUT_KEYS__ = flowLayoutKeys;
        setFlowDiagrams([]);
      }
      if (clusters) {
        window.__FLOW_CLUSTERS__ = clusters;
        setFlowClusters(clusters);
      }
      if (validation) {
        setFlowFindings({
          flowErrors: validation.flowErrors,
          globalErrors: validation.globalErrors,
        });
      }
    }

    function fetchFlowOrNull(context: string): Promise<FlowApiPayload | null> {
      return doFlowFetch().catch(err => {
        if (!ignore) console.error(`[ignatius] ${context} flow fetch failed:`, err);
        return null;
      });
    }

    Promise.all([doModelFetch(), fetchFlowOrNull('boot')])
      .then(([modelPayload, flowPayload]) => {
        if (ignore) return;
        applyModelPayload(modelPayload);
        if (flowPayload) applyFlowPayload(flowPayload);
      })
      .catch(err => { if (!ignore) console.error('[ignatius] boot failed:', err); });

    const es = new EventSource('/events');
    es.addEventListener('model-changed', () => {
      Promise.all([doModelFetch(), fetchFlowOrNull('SSE')])
        .then(([modelPayload, flowPayload]) => {
          if (ignore) return;
          applyModelPayload(modelPayload);
          if (flowPayload) applyFlowPayload(flowPayload);
          setBannerDismissed(false);
          onSseRefreshRef.current?.(modelPayload.validation.cleanedModel);
        })
        .catch(err => { if (!ignore) console.error('[ignatius] SSE refetch failed:', err); });
    });

    return () => {
      ignore = true;
      es.close();
    };
  }, []);

  async function refreshDiff(): Promise<void> {
    const payload = await doModelFetch();
    setDiff(payload.diff);
  }

  return {
    model,
    findings,
    flowDiagrams,
    flowClusters,
    flowFindings,
    diff,
    refreshDiff,
    layoutKeyRef,
    bannerDismissed,
    setBannerDismissed,
  };
}
