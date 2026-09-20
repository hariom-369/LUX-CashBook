import { Link } from 'react-router-dom';
import { Hammer } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { LinkButton } from '../components/ui/LinkButton';
import { EmptyState } from '../components/ui/States';

/**
 * A screen for a feature whose build phase has not landed yet.
 *
 * It exists because the navigation lists every feature the finished product has, and
 * a nav item that 404s is worse than one that says plainly what is happening. It is
 * not a "coming soon" teaser: it names the phase, says what will be here, and points
 * at the parts that do work today. Each of these is deleted as its phase lands.
 */
export function ComingInPhase({ feature, phase }: { feature: string; phase: number }) {
  return (
    <Card className="mx-auto max-w-xl">
      <EmptyState
        icon={<Hammer className="size-5" />}
        title={`${feature} arrives in phase ${phase}`}
        description={`This build has phases 1 and 2 complete: accounts, the full transaction engine, the cash book, and personal ledgers. ${feature} is part of phase ${phase}.`}
        action={
          <LinkButton to="/transactions" variant="secondary" size="sm">
            Go to transactions
          </LinkButton>
        }
        secondaryAction={
          <Link
            to="/"
            className="text-[13px] font-medium text-ink-muted underline-offset-4 hover:text-gold hover:underline"
          >
            Back to dashboard
          </Link>
        }
      />
    </Card>
  );
}
