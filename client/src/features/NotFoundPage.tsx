import { Compass } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { LinkButton } from '../components/ui/LinkButton';
import { EmptyState } from '../components/ui/States';
import { useT } from '../i18n';

export function NotFoundPage() {
  const t = useT();
  return (
    <Card className="mx-auto max-w-lg">
      <EmptyState
        icon={<Compass className="size-5" />}
        titleAs="h1"
        title={t('app.thatPageDoesnTExist')}
        description={t('app.theLinkMayBeOutOf')}
        action={
          <LinkButton to="/" size="sm">
            {t('app.backToDashboard')}
          </LinkButton>
        }
      />
    </Card>
  );
}
