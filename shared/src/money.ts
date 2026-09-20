/**
 * Money.
 *
 * INVARIANT I1: money is *never* a floating point number anywhere in this system.
 * Every amount is an integer count of the currency's smallest unit ("minor units"):
 * paise for INR, cents for USD, and so on. 0.1 + 0.2 !== 0.3 is not an acceptable
 * property for a ledger, so floats never get to touch an amount.
 *
 * Formatting is done with integer arithmetic and string surgery rather than by
 * dividing by 100 and handing the result to Intl, so a large balance can never
 * drift by a paise on its way to the screen.
 */

export interface CurrencyMeta {
  /** ISO 4217 code. */
  code: string;
  /** Symbol shown next to the number. */
  symbol: string;
  /** Decimal places — the exponent used for minor units. */
  decimals: number;
  /** `'indian'` = 1,25,000 ; `'western'` = 125,000 */
  grouping: 'indian' | 'western';
  name: string;
}

export const CURRENCIES: Record<string, CurrencyMeta> = {
  INR: { code: 'INR', symbol: '₹', decimals: 2, grouping: 'indian', name: 'Indian Rupee' },
  USD: { code: 'USD', symbol: '$', decimals: 2, grouping: 'western', name: 'US Dollar' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, grouping: 'western', name: 'Euro' },
  GBP: { code: 'GBP', symbol: '£', decimals: 2, grouping: 'western', name: 'British Pound' },
  AED: { code: 'AED', symbol: 'د.إ', decimals: 2, grouping: 'western', name: 'UAE Dirham' },
  AUD: { code: 'AUD', symbol: 'A$', decimals: 2, grouping: 'western', name: 'Australian Dollar' },
  CAD: { code: 'CAD', symbol: 'C$', decimals: 2, grouping: 'western', name: 'Canadian Dollar' },
  SGD: { code: 'SGD', symbol: 'S$', decimals: 2, grouping: 'western', name: 'Singapore Dollar' },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, grouping: 'western', name: 'Japanese Yen' },
  NPR: { code: 'NPR', symbol: 'रू', decimals: 2, grouping: 'indian', name: 'Nepalese Rupee' },
  LKR: { code: 'LKR', symbol: 'Rs', decimals: 2, grouping: 'indian', name: 'Sri Lankan Rupee' },
  PKR: { code: 'PKR', symbol: '₨', decimals: 2, grouping: 'indian', name: 'Pakistani Rupee' },
  BDT: { code: 'BDT', symbol: '৳', decimals: 2, grouping: 'indian', name: 'Bangladeshi Taka' },
};

export const DEFAULT_CURRENCY = 'INR';

export function currencyMeta(code: string | undefined | null): CurrencyMeta {
  return CURRENCIES[(code ?? DEFAULT_CURRENCY).toUpperCase()] ?? CURRENCIES.INR!;
}

/** The largest amount we accept, in minor units. Keeps us inside exact-integer range. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000_00; // 1 trillion major units

export function isValidAmountMinor(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_AMOUNT_MINOR
  );
}

/** Group an unsigned integer string, Indian or western style. */
function group(digits: string, style: 'indian' | 'western'): string {
  if (style === 'western') {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  // Indian: final group of 3, then groups of 2 — 1,25,000 / 12,34,567
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

export interface FormatMoneyOptions {
  currency?: string;
  /** Include the currency symbol. Default `true`. */
  symbol?: boolean;
  /** Always render a leading `+` for positive values. Default `false`. */
  signed?: boolean;
  /** Drop `.00` when the amount has no fractional part. Default `false`. */
  compactDecimals?: boolean;
  /** Render `₹ ••••••` instead of the number — privacy mode (§38). Default `false`. */
  masked?: boolean;
}

const MASK = '••••••';

/**
 * Format minor units for display. This is the only place in the app that turns a
 * number into money, so privacy masking and Indian grouping are correct everywhere
 * by construction.
 */
export function formatMoney(amountMinor: number, options: FormatMoneyOptions = {}): string {
  const meta = currencyMeta(options.currency);
  const withSymbol = options.symbol !== false;

  if (options.masked) {
    return withSymbol ? `${meta.symbol} ${MASK}` : MASK;
  }

  const safe = Number.isFinite(amountMinor) ? Math.round(amountMinor) : 0;
  const negative = safe < 0;
  const abs = Math.abs(safe);

  const factor = 10 ** meta.decimals;
  const whole = Math.floor(abs / factor);
  const frac = abs - whole * factor;

  let body = group(String(whole), meta.grouping);
  if (meta.decimals > 0) {
    const fracStr = String(frac).padStart(meta.decimals, '0');
    if (!(options.compactDecimals && frac === 0)) {
      body += `.${fracStr}`;
    }
  }

  const sign = negative ? '-' : options.signed ? '+' : '';
  return withSymbol ? `${sign}${meta.symbol}${body}` : `${sign}${body}`;
}

/**
 * Short form for charts and dense tiles: ₹1.2L, ₹3.4Cr (Indian) or ₹12.5K, ₹1.2M.
 * Never used where an exact figure matters.
 */
export function formatMoneyCompact(amountMinor: number, currency?: string, masked = false): string {
  const meta = currencyMeta(currency);
  if (masked) return `${meta.symbol} ${MASK}`;

  const factor = 10 ** meta.decimals;
  const major = amountMinor / factor;
  const abs = Math.abs(major);
  const sign = major < 0 ? '-' : '';

  const units: Array<[number, string]> =
    meta.grouping === 'indian'
      ? [
          [1e7, 'Cr'],
          [1e5, 'L'],
          [1e3, 'K'],
        ]
      : [
          [1e9, 'B'],
          [1e6, 'M'],
          [1e3, 'K'],
        ];

  for (const [threshold, suffix] of units) {
    if (abs >= threshold) {
      const scaled = abs / threshold;
      const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '');
      return `${sign}${meta.symbol}${text}${suffix}`;
    }
  }
  return `${sign}${meta.symbol}${abs.toFixed(abs % 1 === 0 ? 0 : 2)}`;
}

/**
 * Parse human input ("1,25,000.50", "₹ 1234", "1.2k") into minor units.
 * Returns `null` when the text is not a usable amount — callers surface a
 * validation message rather than guessing.
 */
export function parseMoney(input: string, currency?: string): number | null {
  const meta = currencyMeta(currency);
  if (typeof input !== 'string') return null;

  let text = input.trim();
  if (!text) return null;

  // Strip currency symbols, spaces, grouping separators and non-breaking spaces.
  text = text.replace(/[\s ,]/g, '').replace(/[^\d.\-+kKlLcCrRmMbB]/g, '');
  if (!text) return null;

  const shorthand = /^([+-]?\d*\.?\d+)\s*(k|l|cr|m|b)$/i.exec(text);
  let multiplier = 1;
  if (shorthand) {
    text = shorthand[1]!;
    const unit = shorthand[2]!.toLowerCase();
    multiplier = { k: 1e3, l: 1e5, cr: 1e7, m: 1e6, b: 1e9 }[unit] ?? 1;
  }

  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;

  const negative = text.startsWith('-');
  const unsigned = text.replace(/^[+-]/, '');
  const [wholeRaw = '0', fracRaw = ''] = unsigned.split('.');

  const factor = 10 ** meta.decimals;
  // Build minor units with integer maths, then apply any shorthand multiplier.
  const fracPadded = (fracRaw + '0'.repeat(meta.decimals)).slice(0, meta.decimals);
  const base = Number(wholeRaw || '0') * factor + Number(fracPadded || '0');
  const minor = Math.round(base * multiplier);

  if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_AMOUNT_MINOR) return null;
  return negative ? -minor : minor;
}

/** Convert major units (e.g. from a CSV) to minor units, rounding half away from zero. */
export function toMinor(major: number, currency?: string): number {
  const factor = 10 ** currencyMeta(currency).decimals;
  const scaled = major * factor;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** Convert minor units to major units. For export and charts only — never for maths. */
export function toMajor(minor: number, currency?: string): number {
  return minor / 10 ** currencyMeta(currency).decimals;
}

/** Percentage helper that refuses to divide by zero. */
export function safePercent(part: number, whole: number): number {
  if (!whole) return 0;
  return (part / whole) * 100;
}

export function formatPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(decimals).replace(/\.0+$/, '')}%`;
}
