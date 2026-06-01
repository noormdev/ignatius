// Open a URL in the user's default browser. The command differs per OS, so the
// platform → argv mapping is split out as a pure function for unit testing; the
// spawn is a thin, error-swallowing wrapper around it.

/** The argv that opens `url` in the default browser on `platform`. */
export function browserOpenCommand(platform: NodeJS.Platform, url: string): string[] {
  switch (platform) {
    case 'darwin':
      return ['open', url];
    case 'win32':
      // `start` is a cmd builtin; the empty "" is its required title argument.
      return ['cmd', '/c', 'start', '', url];
    default:
      return ['xdg-open', url];
  }
}

/**
 * Fire-and-forget open of `url` in the default browser. Failure to launch never
 * takes down the server — a missing opener (e.g. headless Linux) just logs.
 */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  try {
    Bun.spawn(browserOpenCommand(platform, url), {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Could not open browser automatically: ${msg}\n`);
  }
}
