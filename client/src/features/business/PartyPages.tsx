import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Store, Truck } from 'lucide-react';
import type { PersonDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { usePeople } from '../../lib/queries';
import { Avatar } from '../people/PeoplePage';
import { PersonFormSheet } from '../people/PersonFormSheet';

/**
 * Customers and suppliers (§55).
 *
 * Business mode's navigation names these separately from the generic "People"
 * list because that's the vocabulary a shopkeeper actually uses — but underneath
 * they are the exact same ledger the personal khata uses (§54's whole point:
 * plain-language labels over the same accurate structure). This view is People,
 * pre-filtered by relationship, so a customer's balance and a friend's balance are
 * computed by identical code with identical guarantees.
 */
function PartyList({
  relationship,
  title,
  description,
  icon,
  emptyAction,
}: {
  relationship: 'customer' | 'supplier';
  title: string;
  description: string;
  icon: React.ReactNode;
  emptyAction: string;
}) {
  const { data: people = [], isLoading, isError, error, refetch } = usePeople({ relationship, sortBy: 'balance' });
  const [creating, setCreating] = useState(false);

  const totalOutstanding = people.reduce((sum, p) => sum + Math.abs(p.balanceMinor), 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{title}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Add {relationship}
        </Button>
      </header>

      {people.length > 0 && (
        <div className="rounded-lg border border-line bg-surface px-5 py-4 shadow-xs">
          <p className="label-eyebrow">Total outstanding</p>
          <div className="mt-1.5">
            <Money amountMinor={totalOutstanding} size="xl" tone="neutral" compactDecimals />
          </div>
        </div>
      )}

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={4} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : people.length === 0 ? (
          <EmptyState
            icon={icon}
            title={`No ${relationship}s yet`}
            description={`Add a ${relationship} and every transaction with them builds a running ledger automatically.`}
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {emptyAction}
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {people.map((person: PersonDto) => (
              <li key={person.id}>
                <Link to={`/people/${person.id}`} className="flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-sunken sm:px-6">
                  <Avatar name={person.name} avatarUrl={person.avatarUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{person.name}</span>
                    {person.phone && <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">{person.phone}</span>}
                  </span>
                  <Money
                    amountMinor={Math.abs(person.balanceMinor)}
                    size="md"
                    tone={person.balanceMinor > 0 ? 'positive' : person.balanceMinor < 0 ? 'negative' : 'neutral'}
                    compactDecimals
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <PersonFormSheet open={creating} person={null} onClose={() => setCreating(false)} defaultRelationship={relationship} />
    </div>
  );
}

export function CustomersPage() {
  return (
    <PartyList
      relationship="customer"
      title="Customers"
      description="Who owes you for goods or services — receivables at a glance."
      icon={<Store className="size-5" />}
      emptyAction="Add your first customer"
    />
  );
}

export function SuppliersPage() {
  return (
    <PartyList
      relationship="supplier"
      title="Suppliers"
      description="Who you owe for stock or services — payables at a glance."
      icon={<Truck className="size-5" />}
      emptyAction="Add your first supplier"
    />
  );
}
