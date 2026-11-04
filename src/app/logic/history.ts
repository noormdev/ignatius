import { parseHash, serializeHash } from '../hash-router';
import type { HashState } from '../hash-router';

// A view switch to Flows is followed at once by the diagram it lands on; a push this soon
// after a view-switch push joins it, so Back steps over both. Other pushes stay separate.
const COALESCE_MS = 50;
let lastViewSwitchAt = Number.NEGATIVE_INFINITY;

/** Params that belong to one screen and never carry over to the next navigation. */
const SCREEN_PARAMS = ['entity', 'node', 'section'] as const;

export function currentHash(): HashState {
  return parseHash(location.hash);
}

/** Writes `state` as the hash; `push` adds a history entry, `replace` rewrites the current one.
 *  `viewSwitch` marks a push that a diagram push may follow and join. */
export function writeHash(state: HashState, mode: 'push' | 'replace', viewSwitch = false): void {
  const serialized = serializeHash(state);
  const url = serialized ? `#${serialized}` : location.pathname;
  if (url === location.hash || (serialized === '' && location.hash === '')) return;
  const now = performance.now();
  if (mode === 'replace') {
    history.replaceState({}, '', url);
    return;
  }
  const joinsViewSwitch = !viewSwitch && now - lastViewSwitchAt < COALESCE_MS;
  lastViewSwitchAt = viewSwitch ? now : Number.NEGATIVE_INFINITY;
  if (joinsViewSwitch) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
}

/** The current hash without the screen params, as the base of a navigation to another screen. */
export function navigationBase(): HashState {
  const base: HashState = { ...currentHash() };
  for (const key of SCREEN_PARAMS) delete base[key];
  return base;
}
