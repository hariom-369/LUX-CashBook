/**
 * Trash / Recently Deleted (§Trash).
 *
 * Deleting a supported record moves it to Trash: it disappears from every list, balance and
 * report straight away, can be restored for `TRASH_RETENTION_DAYS`, and is then permanently
 * deleted by the server's scheduler. The clock always runs from the original deletion time.
 */

export const TRASH_RETENTION_DAYS = 30;

export const TRASH_ITEM_TYPES = [
  'transaction',
  'account',
  'person',
  'group',
  'budget',
  'goal',
  'recurring',
  'reminder',
  'document',
] as const;
export type TrashItemType = (typeof TRASH_ITEM_TYPES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an item deleted at `deletedAt` is permanently deleted. */
export function trashExpiresAt(deletedAt: Date | string): Date {
  return new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS);
}

/** Anything deleted at or before this moment has used up its time in Trash. */
export function trashCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS);
}

/** Whole days left before permanent deletion, rounded up (so "less than a day" reads as 1); 0 once expired. */
export function trashDaysRemaining(deletedAt: Date | string, now: Date = new Date()): number {
  const left = trashExpiresAt(deletedAt).getTime() - now.getTime();
  return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
}

/** One item in Trash, as the API lists it. */
export interface TrashItemDto {
  id: string;
  type: TrashItemType;
  /** What the user called it: a description, name or file name. */
  name: string;
  /** Raw secondary text where there is one (a document's file name when it has its own title). */
  detail?: string;
  /** Transactions only: the date it was recorded for. */
  date?: string;
  /** Transactions only: amount, currency and type, to show the figure the way the ledger does. */
  amountMinor?: number;
  currency?: string;
  transactionType?: string;
  deletedAt: string;
  expiresAt: string;
  daysRemaining: number;
}

/** Outcome of restoring one item in a bulk restore. */
export interface TrashRestoreResultDto {
  type: TrashItemType;
  id: string;
  ok: boolean;
  /** Why it could not be restored — the server's message, ready to show. */
  error?: string;
  code?: string;
}
