import { useSyncExternalStore } from 'react';
import { parseSettings, SETTINGS_STORAGE_KEY } from '../logic/settings';
import type { Settings } from '../logic/settings';

type SettingsUpdate = (patch: Partial<Settings>) => void;

function readStoredSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return parseSettings(null);
  }
}

let current = readStoredSettings();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return current;
}

const update: SettingsUpdate = (patch) => {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current));
  } catch {}
  for (const listener of listeners) listener();
};

/** Shared viewer settings for every React root, with a persisting `update`. */
export function useSettings(): [Settings, SettingsUpdate] {
  return [useSyncExternalStore(subscribe, getSnapshot), update];
}
