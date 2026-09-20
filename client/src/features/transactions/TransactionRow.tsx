import { TRANSACTION_META, formatTime, type TransactionDto } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Icon } from '../../components/ui/Icon';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';

/**
 * One line in a transaction list.
 *
 * The visual grammar is what makes a long list scannable:
 *
 *   • Income and expense are tinted and signed.
 *   • A transfer is **deliberately colourless** and carries an "Internal transfer"
 *     badge — it is neither income nor expense (§11, invariant I5), and colouring
 *     it would say otherwise on every screen it appears.
 *   • Lending and borrowing are also colourless, because money moving to a friend
 *     is not spending (invariant I6).
 */
export function TransactionRow({
  transaction,
  onClick,
  showDate = false,
  dense = false,
}: {
  transaction: TransactionDto;
  onClick?: (transaction: TransactionDto) => void;
  showDate?: boolean;
  dense?: boolean;
}) {
  const meta = TRANSACTION_META[transaction.type];
  const isTransfer = meta.isTransfer;

  const icon = transaction.categoryIcon ?? meta.icon;
  const accent = transaction.categoryColor;

  // The sign the user should read, derived from the posting rather than assumed.
  const signedAmount =
    isTransfer || meta.isPersonal
      ? transaction.amountMinor
      : meta.isIncome
        ? transaction.amountMinor
        : -transaction.amountMinor;

  const title =
    transaction.description ||
    transaction.personName ||
    transaction.categoryName ||
    meta.label;

  const subtitleParts = [
    isTransfer
      ? `${accountNameOf(transaction, 'from')} → ${accountNameOf(transaction, 'to')}`
      : transaction.accountName,
    !isTransfer && transaction.categoryName && transaction.description ? transaction.categoryName : null,
    meta.isPersonal && transaction.personName && transaction.description ? transaction.personName : null,
    showDate ? formatTime(transaction.date) : null,
  ].filter(Boolean);

  const Element = onClick ? 'button' : 'div';

  return (
    <li>
      <Element
        {...(onClick ? { type: 'button' as const, onClick: () => onClick(transaction) } : {})}
        className={cn(
          'flex w-full items-center gap-3 text-left transition-colors',
          dense ? 'px-4 py-2.5 sm:px-5' : 'px-5 py-3.5 sm:px-6',
          onClick && 'hover:bg-sunken',
          transaction.deletedAt && 'opacity-55',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md',
            dense ? 'size-8' : 'size-10',
          )}
          style={
            accent
              ? { backgroundColor: `${accent}1F`, color: accent }
              : undefined
          }
        >
          {!accent && (
            <span
              className={cn(
                'flex size-full items-center justify-center rounded-md',
                meta.tone === 'positive' && 'bg-positive-soft text-positive',
                meta.tone === 'negative' && 'bg-negative-soft text-negative',
                meta.tone === 'neutral' && 'bg-neutral-soft text-ink-secondary',
              )}
            >
              <Icon name={icon} className={dense ? 'size-3.5' : 'size-[18px]'} />
            </span>
          )}
          {accent && <Icon name={icon} className={dense ? 'size-3.5' : 'size-[18px]'} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-ink">{title}</span>
            {isTransfer && (
              <Badge tone="neutral" eyebrow className="shrink-0">
                Internal transfer
              </Badge>
            )}
            {transaction.deletedAt && (
              <Badge tone="negative" eyebrow className="shrink-0">
                Deleted
              </Badge>
            )}
            {transaction.isRecurringInstance && (
              <Badge tone="outline" eyebrow className="shrink-0">
                Recurring
              </Badge>
            )}
          </span>

          {subtitleParts.length > 0 && (
            <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
              {subtitleParts.join(' · ')}
            </span>
          )}
        </span>

        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <Money
            amountMinor={signedAmount}
            size={dense ? 'sm' : 'md'}
            // A transfer or a loan gets no colour: it is movement, not earning or spending.
            tone={isTransfer || meta.isPersonal ? 'neutral' : 'auto'}
            signed={!isTransfer && !meta.isPersonal}
            compactDecimals
          />

          {(transaction.type === 'lend' || transaction.type === 'borrow') &&
            transaction.outstandingMinor !== undefined &&
            transaction.outstandingMinor > 0 && (
              <span className="sensitive text-[10.5px] text-ink-muted">
                <Money
                  amountMinor={transaction.outstandingMinor}
                  size="xs"
                  tone="inherit"
                  weight="normal"
                  compactDecimals
                />{' '}
                outstanding
              </span>
            )}

          {(transaction.type === 'lend' || transaction.type === 'borrow') &&
            transaction.isSettled && (
              <span className="text-[10.5px] font-medium text-positive">Settled</span>
            )}
        </span>
      </Element>
    </li>
  );
}

function accountNameOf(transaction: TransactionDto, side: 'from' | 'to'): string {
  const id = side === 'from' ? transaction.fromAccountId : transaction.toAccountId;
  return transaction.postings.find((posting) => posting.accountId === id)?.accountName ?? 'Account';
}
