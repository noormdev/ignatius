/** Viewer preferences persisted in localStorage. */
export type Settings = {
  alwaysOpenExamples: boolean;
};

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  alwaysOpenExamples: false,
};

export const SETTINGS_STORAGE_KEY = 'ignatius-settings';

/** Reads a stored settings value; anything missing, malformed or wrong-typed falls back to its default field by field. */
export function parseSettings(raw: string | null): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (raw === null) return settings;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return settings;
  }
  if (typeof parsed !== 'object' || parsed === null) return settings;

  if ('alwaysOpenExamples' in parsed && typeof parsed.alwaysOpenExamples === 'boolean') {
    settings.alwaysOpenExamples = parsed.alwaysOpenExamples;
  }
  return settings;
}
