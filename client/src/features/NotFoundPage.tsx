import { Compass } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { LinkButton } from '../components/ui/LinkButton';
import { EmptyState } from '../components/ui/States';

export function NotFoundPage() {
  return (
    <Card className="mx-auto max-w-lg">
      <EmptyState
        icon={<Compass className="size-5" />}
        title="That page doesn't exist"
        description="The link may be out of date, or the page may have moved."
        action={
          <LinkButton to="/" size="sm">
            Back to dashboard
          </LinkButton>
        }
      />
    </Card>
  );
}
