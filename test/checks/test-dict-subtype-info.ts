import { parseModels } from '../../src/parse';
import { generateDict } from '../../src/generators/dict';

const model = await parseModels('models/key-inherited');
const html = await generateDict(model, 'dark', { modelsDir: 'models/key-inherited' });

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// Locate the Party subtype cluster — Party is a basetype for Business and Person
const partyCluster = model.subtypeClusters.find(c => c.basetype === 'Party');
assert(partyCluster !== undefined, 'Party cluster exists in model.subtypeClusters');

if (partyCluster) {
  // 1. Party entity section contains badge-basetype span
  assert(
    html.includes('badge-basetype'),
    'Party entity section contains badge-basetype span',
  );

  // 2. The basetype badge mentions exclusive/inclusive based on the cluster config
  const exclusiveText = partyCluster.exclusive ? 'exclusive' : 'inclusive';
  assert(
    html.includes(exclusiveText),
    `basetype badge text includes "${exclusiveText}"`,
  );

  // 3. Each member (subtype) entity section contains badge-subtype-of span
  for (const member of partyCluster.members) {
    assert(
      html.includes('badge-subtype-of'),
      `a subtype entity contains badge-subtype-of span`,
    );
    // The badge renders: of <a href="#entity-Party">Party</a>
    const subtypeOfPattern = `href="#entity-${partyCluster.basetype}">${partyCluster.basetype}</a>`;
    assert(
      html.includes(subtypeOfPattern),
      `badge-subtype-of contains linked basetype "${partyCluster.basetype}" for member ${member}`,
    );
    break; // One check is enough to confirm the pattern; loop below checks all
  }

  // Check every member individually for badge-subtype-of containing the basetype link
  for (const member of partyCluster.members) {
    // The member's own entity-section must contain a badge-subtype-of
    // We locate the section by its id and check it contains the pattern before the next section
    const sectionStart = `id="entity-${member}"`;
    const sectionIdx = html.indexOf(sectionStart);
    assert(sectionIdx !== -1, `${member} entity section present`);

    if (sectionIdx !== -1) {
      // Find next entity-section start (or end of string) to narrow the search window
      const nextSection = html.indexOf('<section class="entity-section"', sectionIdx + 1);
      const slice = nextSection !== -1
        ? html.slice(sectionIdx, nextSection)
        : html.slice(sectionIdx);

      assert(
        slice.includes('badge-subtype-of'),
        `${member} entity section contains badge-subtype-of`,
      );
      assert(
        slice.includes(`href="#entity-${partyCluster.basetype}"`),
        `${member} badge-subtype-of links to basetype #entity-${partyCluster.basetype}`,
      );
    }
  }

  // 4. Basetype section contains .subtype-list paragraph listing each member as a link
  const partySectionStart = html.indexOf(`id="entity-Party"`);
  assert(partySectionStart !== -1, 'Party entity section found');

  if (partySectionStart !== -1) {
    const nextSection = html.indexOf('<section class="entity-section"', partySectionStart + 1);
    const partySlice = nextSection !== -1
      ? html.slice(partySectionStart, nextSection)
      : html.slice(partySectionStart);

    assert(
      partySlice.includes('class="subtype-list"'),
      'Party entity section contains .subtype-list paragraph',
    );

    for (const member of partyCluster.members) {
      assert(
        partySlice.includes(`href="#entity-${member}"`),
        `subtype-list links to member #entity-${member}`,
      );
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll assertions passed.`);
}
