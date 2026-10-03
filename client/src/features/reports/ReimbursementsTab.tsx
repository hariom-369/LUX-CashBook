import { Link } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Money } from '../../components/ui/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useReimbursementSummary } from '../../lib/queries5';
import { useT } from '../../i18n';

/** What is still owed to you across the expenses being tracked for reimbursement (§Phase 7). */
export function ReimbursementsTab() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useReimbursementSummary();

  if (isLoading)
    return (
      <Card>
        <LoadingState rows={3} />
      </Card>
    );
  if (isError)
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  const tracked = data?.byStatus.some((s) => s.count > 0) ?? false;

  return (
    <Card>
      <CardHeader eyebrow={t('reimb.summaryTitle')} title={t('reimb.outstanding')} />
      {!tracked ? (
        <EmptyState title={t('reimb.none')} description={t('reimb.hint')} />
      ) : (
        <>
          <p className="mt-2">
            <Money amountMinor={data!.outstandingMinor} size="xl" tone="neutral" compactDecimals />
          </p>
          <p className="mt-1 text-[12px] text-ink-muted">{t('reimb.bookkeepingNote')}</p>
          <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
            {data!.byStatus.map((s) => (
              <div key={s.status} className="rounded-lg border border-line bg-surface p-4">
                <dt className="label-eyebrow">{t(`reimb.status.${s.status}`)}</dt>
                <dd className="mt-1.5">
                  <Money amountMinor={s.amountMinor} size="md" tone="neutral" compactDecimals />
                  <span className="mt-0.5 block text-[11.5px] text-ink-muted">{t.plural('tags.entries', s.count)}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[12.5px]">
            <Link to="/transactions" className="font-medium text-gold underline underline-offset-4">
              {t('reimb.openList')}
            </Link>
          </p>
        </>
      )}
    </Card>
  );
}
