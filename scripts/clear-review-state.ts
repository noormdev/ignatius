// Checks serve repo models in place, and serve leaves a baseline behind; a stale one would show later checks a Changes panel.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

for (const parent of ['models', 'test/fixtures']) {
  for (const model of readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    rmSync(join(parent, model.name, '.ignatius'), { recursive: true, force: true });
  }
}
