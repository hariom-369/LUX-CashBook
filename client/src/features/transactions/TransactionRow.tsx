import { TRANSACTION_META, formatTime, type TransactionDto } from '@khata/shared';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Icon } from '../../components/ui/Icon';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { useT } from '../../i18n';

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
  selection,
}: {
  transaction: TransactionDto;
  onClick?: (transaction: TransactionDto) => void;
  showDate?: boolean;
  dense?: boolean;
  /** Bulk-select mode (§Phase 16): the row toggles instead of opening the detail sheet. */
  selection?: { checked: boolean; onToggle: (transaction: TransactionDto) => void };
}) {
  const t = useT();
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

  const masked = Boolean(transaction.isMasked);
  const title =
    (masked ? t('transactions.privateTransfer') : transaction.description) ||
    transaction.personName ||
    transaction.categoryName ||
    t.label('txType', transaction.type, meta.label);

  const subtitleParts = [
    isTransfer
      ? masked
        ? // Only the shared leg is visible: name it, and say the other side is private.
          transaction.fromAccountId
          ? `${accountNameOf(transaction, 'from', t('common.account'))} → ${t('transactions.privateAccount')}`
          : `${t('transactions.privateAccount')} → ${accountNameOf(transaction, 'to', t('common.account'))}`
        : `${accountNameOf(transaction, 'from', t('common.account'))} → ${accountNameOf(transaction, 'to', t('common.account'))}`
      : transaction.accountName,
    !isTransfer && transaction.categoryName && transaction.description ? transaction.categoryName : null,
    meta.isPersonal && transaction.personName && transaction.description ? transaction.personName : null,
    showDate ? formatTime(transaction.date) : null,
  ].filter(Boolean);

  const hasBadge = isTransfer || Boolean(transaction.deletedAt) || Boolean(transaction.isRecurringInstance);

  // A masked entry (a transfer with another member's private account) cannot be opened, edited, deleted or selected.
  const interactive = !masked && Boolean(onClick || selection);
  const Element = interactive ? 'button' : 'div';

  return (
    <li>
      <Element
        {...(!interactive
          ? {}
          : selection
          ? {
              type: 'button' as const,
              // A selectable row is a checkbox, not a push button — and it must not contain a second control.
              role: 'checkbox' as const,
              'aria-checked': selection.checked,
              onClick: () => selection.onToggle(transaction),
            }
          : onClick
            ? { type: 'button' as const, onClick: () => onClick(transaction) }
            : {})}
        className={cn(
          'flex w-full items-center gap-3 text-left transition-colors',
          dense ? 'px-4 py-2.5 sm:px-5' : 'px-5 py-3.5 sm:px-6',
          interactive && 'hover:bg-sunken',
          selection?.checked && 'bg-gold-soft',
          transaction.deletedAt && 'opacity-55',
        )}
      >
        {selection && interactive && (
          <span
            aria-hidden
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-sm border',
              selection.checked ? 'border-gold bg-gold text-ink-inverse' : 'border-line-strong bg-surface',
            )}
          >
            {selection.checked && <Check className="size-3" strokeWidth={3} />}
          </span>
        )}
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

        {/*
          The amount drops below the text only when the text would otherwise be
          squeezed under ~6rem — i.e. a large figure on a narrow phone. Wider rows
          are unchanged.
        */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {/* A row with a badge needs room for it (the widest, "Internal transfer", is ~8.5rem). */}
          <span className={cn('min-w-0 flex-1', hasBadge ? 'basis-36' : 'basis-24')}>
            {/* Badges drop under the title on phones instead of eating its width. */}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:flex-nowrap">
              <span className="min-w-0 max-w-full truncate text-[13.5px] font-medium text-ink">{title}</span>
              {isTransfer && (
                <Badge tone="neutral" eyebrow className="shrink-0">
                  {t('transactions.internalTransfer')}
                </Badge>
              )}
              {transaction.deletedAt && (
                <Badge tone="negative" eyebrow className="shrink-0">
                  {t('common.deleted')}
                </Badge>
              )}
              {transaction.isRecurringInstance && (
                <Badge tone="outline" eyebrow className="shrink-0">
                  {t('nav.recurring')}
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
                  {t('transactions.outstanding')}
                </span>
              )}

            {(transaction.type === 'lend' || transaction.type === 'borrow') &&
              transaction.isSettled && (
                <span className="text-[10.5px] font-medium text-positive">{t('common.settled')}</span>
              )}
          </span>
        </span>
      </Element>
    </li>
  );
}

function accountNameOf(transaction: TransactionDto, side: 'from' | 'to', fallback: string): string {
  const id = side === 'from' ? transaction.fromAccountId : transaction.toAccountId;
  return transaction.postings.find((posting) => posting.accountId === id)?.accountName ?? fallback;
}
