import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseModels, type Model } from '../model/parse';
import { validateModel, type EntityError, type GlobalError } from '../model/validate';
import { parseFlows, type FlowModel } from '../flows/flow-parse';
import { isRecord } from '../flows/flow-markdown';
import { validateFlows, type FlowError } from '../flows/flow-validate';
import { readReview } from '../model/change-store';
import { layoutFingerprint } from '../model/layout-fingerprint';
import { buildFlowLayoutKeys } from '../flows/flow-fingerprint';
import { FLOW_LAYOUT_STORAGE_KEY, GRAPH_LAYOUT_STORAGE_KEY } from '../app/logic/storage-keys';
import { generateApp, type GenerateAppOpts, type ViewState } from './app';
import type { BundleContent } from './embedded-bundle';

export type ModelExport = {
  html: string;
  model: Model;
  globalErrors: GlobalError[];
  entityErrors: EntityError[];
  flowErrors: FlowError[];
};

function keepEntries(serialized: string, keep: (entryKey: string) => boolean): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const kept = Object.entries(parsed).filter(([entryKey]) => keep(entryKey));
  return kept.length > 0 ? JSON.stringify(Object.fromEntries(kept)) : null;
}

/** Reduce the layout stores, shared by every model served on the same origin, to this model's entries.
 *  Flow entries are keyed `<flow layout key>::<view>`. */
export function scopeViewState(viewState: ViewState, layoutKey: string, flowLayoutKeys: string[]): ViewState {
  const ownFlowKeys = new Set(flowLayoutKeys);
  const keepers: Record<string, (entryKey: string) => boolean> = {
    [GRAPH_LAYOUT_STORAGE_KEY]: entryKey => entryKey === layoutKey,
    [FLOW_LAYOUT_STORAGE_KEY]: entryKey => ownFlowKeys.has(entryKey.split('::')[0] ?? ''),
  };
  const storage: Record<string, string> = {};
  for (const [key, value] of Object.entries(viewState.storage)) {
    const keep = keepers[key];
    const scoped = keep ? keepEntries(value, keep) : value;
    if (scoped !== null) storage[key] = scoped;
  }
  return { storage, hash: viewState.hash };
}

/** Parse and validate the model root at `dir`, with its flows when present, and render the single-file export. */
export async function exportModel(
  dir: string,
  bundle: BundleContent,
  opts: Omit<GenerateAppOpts, 'review'> = {},
): Promise<ModelExport> {
  const { model, globalErrors: parseGlobalErrors } = await parseModels(dir);
  const validation = validateModel(model);
  const globalErrors = [...parseGlobalErrors, ...validation.globalErrors];

  let flowModel: FlowModel | null = null;
  let flowErrors: FlowError[] = [];
  if (existsSync(join(dir, 'flows'))) {
    const parsed = await parseFlows(dir);
    globalErrors.push(...parsed.globalErrors);
    flowModel = parsed.flowModel;
    flowErrors = validateFlows(flowModel, model, model._meta?.flowRules).flowErrors;
  }

  const review = await readReview(dir, model).catch((err: unknown) => {
    console.error(`ignatius: could not build the change review: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  const viewState = opts.viewState && scopeViewState(
    opts.viewState,
    layoutFingerprint(model),
    flowModel ? Object.values(buildFlowLayoutKeys(flowModel)) : [],
  );
  const html = await generateApp(model, flowModel, bundle, { ...opts, review, viewState });
  return { html, model, globalErrors, entityErrors: validation.entityErrors, flowErrors };
}
