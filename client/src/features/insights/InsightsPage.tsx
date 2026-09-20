import { Sparkles } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useDashboard } from '../../lib/queries';
import { cn } from '../../lib/cn';

/**
 * Insights (§49).
 *
 * The dashboard already computes these — this page just gives them room to
 * breathe and be read as a list, rather than three lines squeezed under a chart.
 * Deliberately descriptive only: what changed and where the money went, never a
 * recommendation. §49 draws that line explicitly, and the wording throughout
 * (`buildInsights` on the server) is written to stay on the descriptive side of it.
 */
export function InsightsPage() {
  const { data, isLoading, isError, error, refetch } = useDashboard('last_30_days');
  const insights = data?.insights ?? [];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Insights</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">What changed and where the money went, based on your last 30 days.</p>
      </header>

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={4} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : insights.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="Nothing to report yet"
            description="Once you've recorded a bit more activity, patterns and comparisons will show up here."
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {insights.map((insight) => (
              <li key={insight.id} className="flex items-start gap-4 px-5 py-5 sm:px-6">
                <span
                  className={cn(
                    'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md',
                    insight.tone === 'positive' && 'bg-positive-soft text-positive',
                    insight.tone === 'negative' && 'bg-negative-soft text-negative',
                    insight.tone === 'neutral' && 'bg-gold-soft text-gold-strong',
                  )}
                >
                  <Icon name={insight.icon} className="size-[18px]" />
                </span>
                <p className="sensitive text-[14px] leading-relaxed text-ink-secondary">{insight.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
