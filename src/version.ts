// Single source of truth for the CLI version. Bun inlines this JSON import at
// build time, so `bun build --compile` bakes the package.json version into the
// binary — `ignatius version` reports the release it was built from.
import pkg from '../package.json';

export const VERSION: string = pkg.version;
