import type { ImportDateFormat } from '@khata/shared';

/**
 * Parsing for bank-statement CSVs (docs/PRODUCT_AUDIT.md D-3, Phase 5).
 *
 * `new Date(string)` — what the existing Khata-format importer uses — only
 * reliably parses ISO dates and silently misreads `dd/mm/yyyy` as
 * month-first, and has no idea what to do with Indian lakh/crore digit
 * grouping (`1,00,000.50`). Both are common enough in Indian bank exports that
 * getting them wrong would corrupt amounts and dates on import without
 * raising an error — worse than refusing the file outright.
 */

export function parseStatementDate(raw: string, format: ImportDateFormat): Date | null {
  const value = raw.trim();
  if (!value) return null;

  if (format === 'yyyy-mm-dd') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
    if (!m) return null;
    return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (!m) return null;
  const [, a, b, year] = m;
  if (format === 'mm/dd/yyyy') return buildDate(Number(year), Number(a), Number(b));
  // dd/mm/yyyy and dd-mm-yyyy both read day first, month second.
  return buildDate(Number(year), Number(b), Number(a));
}

function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0);
  // Reject "31 Feb" style overflow (JS would otherwise roll it into March).
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/**
 * Parses a money string that may use Indian digit grouping (`1,00,000.50`),
 * Western grouping (`100,000.50`), a trailing/leading sign, or parentheses
 * for a negative (`(500.00)`, as some statements render a debit). Returns the
 * amount in minor units (paise), or `null` if the string isn't a number once
 * grouping separators are stripped.
 */
export function parseStatementAmount(raw: string): number | null {
  let value = raw.trim();
  if (!value) return null;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.startsWith('-')) {
    negative = true;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }

  value = value.replace(/[,\s]/g, '').replace(/^(Rs\.?|INR|₹)\s*/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;

  const minor = Math.round(Number(value) * 100);
  return negative ? -minor : minor;
}
