import { asJsonValue } from '../../logic/json-value';
import { JsonValue } from './JsonValue';

/**
 * One cell of an example row, shared by the entity accordions and the process
 * in/out tables so a structured value renders the same wherever it surfaces.
 *
 * `columnType` is the declared type when the caller has a column definition to
 * hand; process example rows are free-form, so they omit it and only nested
 * values are recognised.
 */
export function ExampleCell({ value, columnType, label, emptyClassName }: {
  value: unknown;
  columnType?: string;
  label: string;
  emptyClassName: string;
}) {
  if (value === undefined || value === null || value === '') {
    return <span className={emptyClassName}>–</span>;
  }

  const json = asJsonValue(value, columnType);
  if (json !== null) return <JsonValue value={json} label={label} />;

  return <>{String(value)}</>;
}
