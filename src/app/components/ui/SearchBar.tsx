import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

/**
 * Imperative handle exposed by SearchBar to the shell. `focus()` is unused by
 * CP2 (Graph wiring) but is required by CP4's `/` keyboard shortcut, which
 * focuses the active view's search input — exposing it now means CP4 wires a
 * ref instead of reshaping this component.
 */
export interface SearchBarHandle {
  focus(): void;
}

export interface SearchBarProps {
  /** Committed search term — debounced 200ms from user input (mirrors DictionaryView's echo-guard pattern below). */
  term: string;
  onTermChange: (term: string) => void;
  includeBody: boolean;
  onIncludeBodyChange: (includeBody: boolean) => void;
  /** Match count for the "n of N" readout. null hides the readout (no active term). */
  matchCount: number | null;
  totalCount: number;
  /** Enter key — the caller decides what "next" means (Graph cycles matches; Flows opens the first result row). */
  onEnter: () => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
  /** Results slot — unused by the Graph bar (CP2); the Flows bar (CP3) renders its dropdown here. */
  children?: ReactNode;
}

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(
  function SearchBar(
    {
      term,
      onTermChange,
      includeBody,
      onIncludeBodyChange,
      matchCount,
      totalCount,
      onEnter,
      placeholder,
      ariaLabel,
      className,
      children,
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({
      focus() {
        inputRef.current?.focus();
      },
    }), []);

    // Debounced, echo-guarded input — same pattern as DictionaryView's search
    // box: keystrokes land in local state immediately (input stays
    // responsive); the committed term (the `term` prop) updates 200ms after
    // typing pauses. An external commit (e.g. the shell clearing the term)
    // syncs back into the input and cancels any pending debounce.
    const [input, setInput] = useState(term);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastCommittedRef = useRef<string | null>(null);

    useEffect(() => {
      if (lastCommittedRef.current !== null && term === lastCommittedRef.current) {
        lastCommittedRef.current = null;
        return; // own-commit echo — input already shows this value
      }
      lastCommittedRef.current = null;
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setInput(term);
    }, [term]);

    useEffect(() => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    }, []);

    function commit(value: string) {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      lastCommittedRef.current = value;
      onTermChange(value);
    }

    function handleChange(value: string) {
      setInput(value);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => commit(value), 200);
    }

    function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
      if (e.key === 'Enter') {
        // Flush any pending debounce first so cycling always operates on the
        // term actually shown in the input, not a stale committed value.
        if (debounceRef.current !== null) commit(input);
        onEnter();
      } else if (e.key === 'Escape') {
        setInput('');
        commit('');
        inputRef.current?.blur();
      }
    }

    return (
      <div className={`viewer-search-bar${className ? ` ${className}` : ''}`}>
        <div className="viewer-search-bar-inner">
          <input
            ref={inputRef}
            type="search"
            className="viewer-search-input"
            placeholder={placeholder}
            value={input}
            onChange={e => handleChange(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            aria-label={ariaLabel}
          />
          <button
            type="button"
            className={`viewer-search-body-toggle${includeBody ? ' viewer-search-body-toggle--active' : ''}`}
            aria-pressed={includeBody}
            onClick={() => onIncludeBodyChange(!includeBody)}
            title="Include body text in search"
          >
            Body
          </button>
          {matchCount !== null && (
            <span className="viewer-search-count">{matchCount} of {totalCount}</span>
          )}
        </div>
        {children}
      </div>
    );
  },
);
