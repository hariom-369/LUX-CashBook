import { formatDate, type CashFlowPointDto } from '@khata/shared';

/**
 * A chart bucket's label in the interface language.
 *
 * The server labels buckets in English ("3 Oct", "Oct", "2026"). It also sends the bucket's first
 * day, so the client can write the same label with its own month names. A label of any other
 * shape, or a point from an older server without `start`, is shown as the server wrote it.
 */
export function bucketLabel(point: Pick<CashFlowPointDto, 'label' | 'start'>): string {
  const { label, start } = point;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return label;
  const month = formatDate(`${start}T12:00:00`, 'MMM');
  if (/^\d{1,2} [A-Za-z]{3}$/.test(label)) return `${Number(start.slice(8, 10))} ${month}`;
  if (/^[A-Za-z]{3}$/.test(label)) return month;
  return label;
}
