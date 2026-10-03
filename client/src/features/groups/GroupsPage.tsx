import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus, Users } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useGroups } from '../../lib/queries3';
import { GroupFormSheet } from './GroupFormSheet';
import { useT } from '../../i18n';

/**
 * Expense groups (docs/FEATURE_ROADMAP.md Phase 8, decision 1) — a trip,
 * flatmates, a family. Each group expense you pay is split into your own
 * share plus a loan to each member, so "who owes you" is just the ordinary
 * person ledger, not a separate balance this page invents.
 */
export function GroupsPage() {
  const t = useT();
  const { data: groups = [], isLoading, isError, error, refetch } = useGroups();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.groups')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('groups.splitSharedExpensesWithATrip')}</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('groups.newGroup')}
        </Button>
      </header>

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={3} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={t('groups.noGroupsYet')}
            description={t('groups.createAGroupForATrip')}
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('groups.createYourFirstGroup')}
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {groups.map((group) => (
              <li key={group.id}>
                <Link to={`/groups/${group.id}`} className="flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-sunken sm:px-6">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-gold-soft text-gold-strong">
                    <Users className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{group.name}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">{group.memberNames.join(', ')}</p>
                  </div>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <GroupFormSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
