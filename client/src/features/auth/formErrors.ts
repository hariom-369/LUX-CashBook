import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiRequestError } from '../../lib/api';

/**
 * Put server-side validation errors on the right inputs.
 *
 * The API returns `fields: [{ path, message }]` precisely so this is possible: a
 * rejected field lands under the field itself rather than as a banner the user has
 * to map back onto the form themselves.
 *
 * Returns `true` when every error was placed, so the caller knows whether it still
 * needs to show a form-level message.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: ApiRequestError,
  setError: UseFormSetError<T>,
  knownFields?: Array<Path<T>>,
): boolean {
  if (!error.fields.length) return false;

  let placed = 0;
  for (const field of error.fields) {
    const path = field.path as Path<T>;
    if (knownFields && !knownFields.includes(path)) continue;
    setError(path, { type: 'server', message: field.message });
    placed++;
  }

  return placed === error.fields.length && placed > 0;
}
