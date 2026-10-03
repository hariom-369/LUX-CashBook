import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus, Search, Users } from 'lucide-react';
import { PERSON_RELATIONSHIP_LABELS, type PersonDto } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { usePeople } from '../../lib/queries';
import { useDebounced } from '../../hooks/useDebounced';
import { PersonFormSheet } from './PersonFormSheet';
import { useT, msg, type MessageRef } from '../../i18n';

type StatusFilter = 'all' | 'receivable' | 'payable' | 'settled';

const FILTERS: Array<{ value: StatusFilter; label: MessageRef }> = [
  { value: 'all', label: msg('people.everyone') },
  { value: 'receivable', label: msg('people.willReceive') },
  { value: 'payable', label: msg('people.needToPay') },
  { value: 'settled', label: msg('common.settled') },
];

/**
 * People (§12).
 *
 * The heart of a khata. The wording is the important part: "You will receive" and
 * "You need to pay" rather than debit and credit, because the people who keep an
 * informal ledger are not accountants and the terminology is what usually makes
 * these apps unusable for them (§54).
 */
export function PeoplePage() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<PersonDto | null>(null);
  const [creating, setCreating] = useState(false);

  const debouncedSearch = useDebounced(search, 300);
  const { data: people = [], isLoading, isError, error, refetch } = usePeople({
    search: debouncedSearch || undefined,
    status,
    sortBy: 'balance',
  });

  const { receivable, payable } = useMemo(
    () => ({
      receivable: people.filter((p) => p.balanceMinor > 0).reduce((sum, p) => sum + p.balanceMinor, 0),
      payable: people.filter((p) => p.balanceMinor < 0).reduce((sum, p) => sum - p.balanceMinor, 0),
    }),
    [people],
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.people')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {t('people.whoOwesYouWhoYouOwe')}
          </p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('people.addPerson')}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryCard label={t('people.youWillReceive')} amountMinor={receivable} tone="positive" />
        <SummaryCard label={t('people.youNeedToPay')} amountMinor={payable} tone="negative" />
      </div>

      <Card bare className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Full row on phones so the filter chips can't squeeze it to nothing. */}
          <div className="min-w-0 grow basis-full sm:basis-0 sm:max-w-xs">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('people.searchByNameOrPhone')}
              leftSlot={<Search aria-hidden className="size-4" />}
              aria-label={t('people.searchPeople')}
            />
          </div>

          <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatus(filter.value)}
                aria-pressed={status === filter.value}
                className={cn(
                  'whitespace-nowrap rounded-sm px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                  status === filter.value
                    ? 'bg-ink text-ink-inverse'
                    : 'text-ink-muted hover:bg-sunken hover:text-ink',
                )}
              >
                {t(filter.label.key)}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={5} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : people.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={debouncedSearch ? t('common.nobodyMatchesThat') : t('people.noOneHereYet')}
            description={
              debouncedSearch
                ? t('people.tryADifferentNameOrClear')
                : t('people.addThePeopleYouLendTo')
            }
            action={
              !debouncedSearch ? (
                <Button
                  variant="gold"
                  size="sm"
                  leftIcon={<Plus className="size-4" />}
                  onClick={() => setCreating(true)}
                >
                  {t('people.addYourFirstPerson')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {people.map((person) => (
              <li key={person.id}>
                <Link
                  to={`/people/${person.id}`}
                  className="flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-sunken sm:px-6"
                >
                  <Avatar name={person.name} avatarUrl={person.avatarUrl} />

                  {/* The balance drops below the name only when both can't share a line. */}
                  <span className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3.5 gap-y-1">
                    <span className="min-w-0 flex-1 basis-24">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:flex-nowrap">
                        <span className="min-w-0 max-w-full truncate text-[14px] font-medium text-ink">
                          {person.name}
                        </span>
                        {person.relationship !== 'friend' && (
                          <Badge tone="outline" eyebrow>
                            {t.label('relationship', person.relationship, PERSON_RELATIONSHIP_LABELS[person.relationship])}
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                        {balanceLabel(person, t)}
                      </span>
                    </span>

                    <Money
                      amountMinor={Math.abs(person.balanceMinor)}
                      size="md"
                      tone={
                        person.balanceMinor > 0 ? 'positive' : person.balanceMinor < 0 ? 'negative' : 'neutral'
                      }
                      compactDecimals
                    />
                  </span>

                  <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <PersonFormSheet
        open={creating || Boolean(editing)}
        person={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function balanceLabel(person: PersonDto, t: ReturnType<typeof useT>): string {
  if (person.balanceMinor > 0) return t('people.youWillReceive');
  if (person.balanceMinor < 0) return t('people.youNeedToPay');
  return person.lastTransactionAt ? t('common.settled') : t('common.noTransactionsYet');
}

export function Avatar({
  name,
  avatarUrl,
  size = 'md',
}: {
  name: string;
  avatarUrl?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const dimension = { sm: 'size-8 text-[11px]', md: 'size-10 text-[12.5px]', lg: 'size-14 text-base' }[size];

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-sunken font-semibold text-ink-secondary',
        dimension,
      )}
    >
      {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : initials}
    </span>
  );
}

function SummaryCard({
  label,
  amountMinor,
  tone,
}: {
  label: string;
  amountMinor: number;
  tone: 'positive' | 'negative';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-5 py-4 shadow-xs">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-2">
        <Money amountMinor={amountMinor} size="xl" tone={amountMinor === 0 ? 'neutral' : tone} compactDecimals />
      </div>
    </div>
  );
}
