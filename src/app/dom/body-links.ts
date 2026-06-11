// Shared body-click resolver for all DD body divs (entity/process/external/store).
// Handles live `<a data-entity>` anchors AND `.entity-link--missing` spans
// (resolved at click time — survives React reconciliation).
// scrollFn should be the caller's scrollToSection; it no-ops if the id matches nothing.
//
// The event param is typed as a minimal structural type so this dom/ helper carries
// no React dependency — React onClick handlers (MouseEvent<HTMLDivElement>) satisfy it.
export function resolveBodyClick(
  e: { target: EventTarget | null; preventDefault(): void },
  scrollFn: (id: string) => void,
): void {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const link = t.closest('a[data-entity]');
  if (link) {
    e.preventDefault();
    const id = link.getAttribute('data-entity');
    if (id) scrollFn(id);
    return;
  }
  const span = t.closest('span.entity-link--missing');
  if (span) {
    const title = span.getAttribute('title') ?? '';
    const prefix = 'Unknown entity: ';
    if (title.startsWith(prefix)) {
      e.preventDefault();
      const target = title.slice(prefix.length);
      scrollFn(target);
    }
  }
}

/**
 * Upgrade `.entity-link--missing` spans inside `container` to live anchor
 * elements when their target ID appears in `allKnownIds`.
 *
 * Entity bodies are rendered at parse time with knownIds = entity IDs only,
 * so a `[[Customer]]` reference in an entity body emits a missing span even
 * when Customer exists as a flow external. This pass resolves those references
 * client-side after the full set of node IDs (entities + externals + stores +
 * processes) is known.
 *
 * Exported for unit testing; the upgrade is side-effecting (mutates the DOM).
 */
export function upgradeMissingLinksInContainer(
  container: ParentNode,
  allKnownIds: ReadonlySet<string>,
): void {
  const spans = container.querySelectorAll<HTMLElement>('span.entity-link--missing');
  for (const span of spans) {
    // Target is encoded in `title="Unknown entity: <target>"`.
    const title = span.getAttribute('title') ?? '';
    const prefix = 'Unknown entity: ';
    if (!title.startsWith(prefix)) continue;
    const target = title.slice(prefix.length);
    if (!allKnownIds.has(target)) continue;

    // Replace span with a live anchor carrying data-entity so the parent body
    // div's click delegation picks it up. Href is "#" (neutral) because the
    // correct section prefix (entity/external/store/process) is resolved at
    // click time by scrollToSection — hardcoding #entity-* would be wrong for
    // externals, stores, and processes.
    const anchor = document.createElement('a');
    anchor.className = 'entity-link';
    anchor.setAttribute('data-entity', target);
    anchor.setAttribute('href', '#');
    anchor.textContent = span.textContent ?? '';
    span.replaceWith(anchor);
  }
}
