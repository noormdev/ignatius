import { useEffect, useRef, useState } from 'react';
import { validateModel } from '../../model/validate';
import type { EntityError, GlobalError } from '../../model/validate';
import type { Model, ModelNode } from '../../model/parse';
import type { FlowDiagram } from '../../flows/flow-parse';
import type { FlowError, FlowValidationResult } from '../../flows/flow-validate';

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

// Unified SSE subscription + model/flow fetch + findings state.
// In static mode: reads window.__MODEL__ / __FLOW_MODEL__ once on mount.
// In live mode: boots with parallel /api/model + /api/flow, then re-fetches
// both on every 'model-changed' SSE event.
export function useModelData(opts?: UseModelDataOptions): {
  model: Model | null;
  findings: ModelFindings;
  flowDiagrams: FlowDiagram[] | null;
  flowFindings: FlowFindings;
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
  const [flowFindings, setFlowFindings] = useState<FlowFindings>({
    flowErrors: [],
    globalErrors: [],
  });
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const layoutKeyRef = useRef<string>('');

  // Keep a live ref to the callback so the SSE closure doesn't go stale.
  const onSseRefreshRef = useRef(opts?.onSseRefresh);
  onSseRefreshRef.current = opts?.onSseRefresh;

  type ModelApiPayload = {
    model: Model;
    parseGlobalErrors: GlobalError[];
    validation: { cleanedModel: Model; globalErrors: GlobalError[]; entityErrors: EntityError[] };
    layoutKey?: string;
  };

  type FlowApiPayload = {
    diagrams: FlowDiagram[];
    flowLayoutKeys: Record<string, string>;
    entityModel?: Model;
    validation?: FlowValidationResult;
  };

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
    }

    function applyFlowPayload(payload: FlowApiPayload) {
      const { diagrams, flowLayoutKeys, entityModel, validation } = payload;
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
      if (validation) {
        setFlowFindings({
          flowErrors: validation.flowErrors,
          globalErrors: validation.globalErrors,
        });
      }
    }

    function doModelFetch(): Promise<ModelApiPayload> {
      return fetch('/api/model').then(r => r.json());
    }
    function doFlowFetch(): Promise<FlowApiPayload> {
      return fetch('/api/flow').then(r => r.json());
    }

    Promise.all([doModelFetch(), doFlowFetch()])
      .then(([modelPayload, flowPayload]) => {
        if (ignore) return;
        applyModelPayload(modelPayload);
        applyFlowPayload(flowPayload);
      })
      .catch(err => { if (!ignore) console.error('[ignatius] boot co-fetch failed:', err); });

    const es = new EventSource('/events');
    es.addEventListener('model-changed', () => {
      Promise.all([doModelFetch(), doFlowFetch()])
        .then(([modelPayload, flowPayload]) => {
          if (ignore) return;
          applyModelPayload(modelPayload);
          applyFlowPayload(flowPayload);
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

  return {
    model,
    findings,
    flowDiagrams,
    flowFindings,
    layoutKeyRef,
    bannerDismissed,
    setBannerDismissed,
  };
}
