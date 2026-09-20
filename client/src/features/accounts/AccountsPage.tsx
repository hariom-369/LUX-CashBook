import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus, Wallet } from 'lucide-react';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_META, type AccountDto, type AccountType } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useAccounts } from '../../lib/queries';
import { AccountFormSheet } from './AccountFormSheet';

/**
 * Accounts (§8).
 *
 * Grouped by type, with assets and liabilities totalled separately — a credit card
 * balance of −₹15,000 is not "money you have", and adding it into one figure would
 * misstate the position.
 */
export function AccountsPage() {
  const { data: accounts = [], isLoading, isError, error, refetch } = useAccounts(true);
  const [editing, setEditing] = useState<AccountDto | null>(null);
  const [creating, setCreating] = useState(false);

  const { assets, liabilities, byType } = useMemo(() => {
    let assetTotal = 0;
    let liabilityTotal = 0;
    const groups = new Map<AccountType, AccountDto[]>();

    for (const account of accounts) {
      groups.set(account.type, [...(groups.get(account.type) ?? []), account]);
      if (account.excludeFromTotals || !account.isActive) continue;
      if (account.isLiability) {
        liabilityTotal += Math.abs(Math.min(account.balanceMinor, 0));
        assetTotal += Math.max(account.balanceMinor, 0);
      } else {
        assetTotal += account.balanceMinor;
      }
    }

    return { assets: assetTotal, liabilities: liabilityTotal, byType: groups };
  }, [accounts]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Accounts</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Cash, bank, UPI, wallets and cards — each with its own ledger.
          </p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Add account
        </Button>
      </header>

      {accounts.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <TotalTile label="Assets" amountMinor={assets} tone="positive" />
          <TotalTile label="Liabilities" amountMinor={liabilities} tone="negative" />
          <TotalTile label="Net" amountMinor={assets - liabilities} tone="neutral" emphasise />
        </div>
      )}

      {isLoading ? (
        <Card>
          <LoadingState rows={4} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet className="size-5" />}
            title="No accounts yet"
            description="Add the places your money actually sits — a cash wallet, your bank, a UPI balance — and every transaction can be recorded against one."
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Add your first account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {ACCOUNT_TYPES.filter((type) => byType.has(type)).map((type) => (
            <Card key={type} bare>
              <div className="p-5 pb-3 sm:p-6 sm:pb-3">
                <CardHeader
                  eyebrow={ACCOUNT_TYPE_META[type].label}
                  title={`${byType.get(type)!.length} ${byType.get(type)!.length === 1 ? 'account' : 'accounts'}`}
                />
              </div>

              <ul className="divide-y divide-line-faint border-t border-line-faint">
                {byType.get(type)!.map((account) => (
                  <li key={account.id} className="flex items-stretch">
                    <Link
                      to={`/accounts/${account.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3.5 px-5 py-4 transition-colors hover:bg-sunken sm:px-6"
                    >
                      <span
                        aria-hidden
                        className="flex size-10 shrink-0 items-center justify-center rounded-md"
                        style={{ backgroundColor: `${account.color}1F`, color: account.color }}
                      >
                        <Icon name={account.icon} className="size-[18px]" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-medium text-ink">{account.name}</span>
                          {!account.isActive && (
                            <Badge tone="outline" eyebrow>
                              Inactive
                            </Badge>
                          )}
                          {account.excludeFromTotals && (
                            <Badge tone="outline" eyebrow>
                              Excluded
                            </Badge>
                          )}
                        </span>
                        {(account.bankName || account.last4) && (
                          <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                            {[account.bankName, account.last4 && `•••• ${account.last4}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </span>

                      <Money
                        amountMinor={account.balanceMinor}
                        size="md"
                        tone={account.balanceMinor < 0 ? 'negative' : 'neutral'}
                        compactDecimals
                      />

                      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
                    </Link>

                    <button
                      type="button"
                      onClick={() => setEditing(account)}
                      className="shrink-0 border-l border-line-faint px-4 text-[12.5px] font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
                    >
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <AccountFormSheet
        open={creating || Boolean(editing)}
        account={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function TotalTile({
  label,
  amountMinor,
  tone,
  emphasise,
}: {
  label: string;
  amountMinor: number;
  tone: 'positive' | 'negative' | 'neutral';
  emphasise?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-surface px-4 py-3.5 shadow-xs',
        emphasise ? 'border-gold/40' : 'border-line',
      )}
    >
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">
        <Money amountMinor={amountMinor} size={emphasise ? 'lg' : 'md'} tone={tone} compactDecimals />
      </div>
    </div>
  );
}
