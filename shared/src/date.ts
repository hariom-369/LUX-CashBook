/**
 * Date helpers shared by the API and the UI.
 *
 * Financial periods are *calendar* concepts, not instants: "September 2026" must
 * mean the same range on the server and in the browser regardless of where either
 * is running. Everything here therefore works on local-calendar boundaries and the
 * caller supplies the timezone when it matters.
 */

export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

export const RANGE_PRESETS = [
  'today', 'yesterday', 'this_week', 'last_week', 'last_7_days', 'last_30_days',
  'this_month', 'last_month', 'last_3_months', 'last_6_months', 'this_quarter',
  'this_year', 'last_year', 'last_12_months', 'all_time', 'custom',
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today', yesterday: 'Yesterday', this_week: 'This Week', last_week: 'Last Week',
  last_7_days: 'Last 7 Days', last_30_days: 'Last 30 Days', this_month: 'This Month',
  last_month: 'Last Month', last_3_months: 'Last 3 Months', last_6_months: 'Last 6 Months',
  this_quarter: 'This Quarter', this_year: 'This Year', last_year: 'Last Year',
  last_12_months: 'Last 12 Months', all_time: 'All Time', custom: 'Custom',
};

export interface DateRange {
  from: Date;
  to: Date;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  // Clamp: 31 Jan + 1 month = 28/29 Feb, not 2/3 Mar.
  x.setDate(Math.min(day, daysInMonth(x.getFullYear(), x.getMonth())));
  return x;
}

export function addYears(d: Date, n: number): Date {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function startOfMonth(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonth(d: Date): Date {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function startOfWeek(d: Date, firstDayOfWeek = 1): Date {
  const x = startOfDay(d);
  const diff = (x.getDay() - firstDayOfWeek + 7) % 7;
  return addDays(x, -diff);
}

export function endOfWeek(d: Date, firstDayOfWeek = 1): Date {
  return endOfDay(addDays(startOfWeek(d, firstDayOfWeek), 6));
}

export function startOfQuarter(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1));
}

export function endOfQuarter(d: Date): Date {
  return endOfDay(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0));
}

export function startOfYear(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), 0, 1));
}

export function endOfYear(d: Date): Date {
  return endOfDay(new Date(d.getFullYear(), 11, 31));
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function diffInDays(a: Date, b: Date): number {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime();
  return Math.round(ms / 86_400_000);
}

/** Resolve a preset into a concrete range. `now` is injectable so tests are deterministic. */
export function resolveRange(
  preset: RangePreset,
  now: Date = new Date(),
  firstDayOfWeek = 1,
): DateRange {
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const y = addDays(now, -1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'this_week':
      return { from: startOfWeek(now, firstDayOfWeek), to: endOfWeek(now, firstDayOfWeek) };
    case 'last_week': {
      const prev = addDays(startOfWeek(now, firstDayOfWeek), -7);
      return { from: prev, to: endOfWeek(prev, firstDayOfWeek) };
    }
    case 'last_7_days':
      return { from: startOfDay(addDays(now, -6)), to: endOfDay(now) };
    case 'last_30_days':
      return { from: startOfDay(addDays(now, -29)), to: endOfDay(now) };
    case 'this_month':
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'last_month': {
      const prev = addMonths(startOfMonth(now), -1);
      return { from: prev, to: endOfMonth(prev) };
    }
    case 'last_3_months':
      return { from: startOfMonth(addMonths(now, -2)), to: endOfMonth(now) };
    case 'last_6_months':
      return { from: startOfMonth(addMonths(now, -5)), to: endOfMonth(now) };
    case 'this_quarter':
      return { from: startOfQuarter(now), to: endOfQuarter(now) };
    case 'this_year':
      return { from: startOfYear(now), to: endOfYear(now) };
    case 'last_year': {
      const prev = addYears(now, -1);
      return { from: startOfYear(prev), to: endOfYear(prev) };
    }
    case 'last_12_months':
      return { from: startOfMonth(addMonths(now, -11)), to: endOfMonth(now) };
    case 'all_time':
      return { from: new Date(1970, 0, 1), to: endOfDay(now) };
    case 'custom':
    default:
      return { from: startOfMonth(now), to: endOfMonth(now) };
  }
}

/** Pick a sensible bucket size so a chart never renders 400 bars. */
export function autoGranularity(range: DateRange): Granularity {
  const days = diffInDays(range.to, range.from);
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  if (days <= 800) return 'month';
  return 'year';
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(year: number, monthIndex: number, long = false): string {
  const names = long ? MONTHS_LONG : MONTHS_SHORT;
  return `${names[monthIndex] ?? ''} ${year}`;
}

/** `yyyy-MM-dd` in local time — the key format used for day buckets everywhere. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse `yyyy-MM-dd` as a *local* date, avoiding the UTC shift `new Date(str)` applies. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function formatDate(d: Date | string, pattern = 'dd MMM yyyy'): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return pattern
    .replace('yyyy', yyyy)
    .replace('MMM', MONTHS_SHORT[date.getMonth()] ?? '')
    .replace('MM', MM)
    .replace('dd', dd);
}

export function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/** "Today", "Yesterday", "3 days ago", then a real date. Used in transaction lists. */
export function relativeDay(d: Date | string, now: Date = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  const delta = diffInDays(now, date);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  if (delta === -1) return 'Tomorrow';
  if (delta > 1 && delta < 7) return `${delta} days ago`;
  if (delta < -1 && delta > -7) return `In ${Math.abs(delta)} days`;
  return formatDate(date, 'dd MMM yyyy');
}
