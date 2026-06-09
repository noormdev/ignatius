/**
 * Minimal ambient declarations for the CSS Custom Highlight API.
 * Not yet in TypeScript's lib.dom.d.ts as of TS 5.x.
 * Spec: https://www.w3.org/TR/css-highlight-api-1/
 *
 * TODO: remove this file once lib.dom ships native Highlight / HighlightRegistry
 * declarations (track https://github.com/microsoft/TypeScript/issues/53003).
 * The `declare const CSS` below shadows the lib.dom built-in; once the built-in
 * carries `highlights`, delete this file entirely.
 */

interface Highlight {
  add(range: AbstractRange): void;
  clear(): void;
  readonly size: number;
}

declare const Highlight: {
  new (...ranges: AbstractRange[]): Highlight;
};

interface HighlightRegistry {
  set(name: string, highlight: Highlight): HighlightRegistry;
  get(name: string): Highlight | undefined;
  delete(name: string): boolean;
  has(name: string): boolean;
  clear(): void;
  readonly size: number;
}

interface CSS {
  highlights: HighlightRegistry;
}

declare const CSS: CSS & {
  escape(ident: string): string;
  supports(property: string, value?: string): boolean;
};
