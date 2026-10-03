import { useState } from 'react';
import { Briefcase, Plus } from 'lucide-react';
import type { ProjectDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useProjects } from '../../lib/queries4';
import { ProjectFormSheet } from './ProjectFormSheet';
import { ProjectDetailSheet } from './ProjectDetailSheet';
import { useT } from '../../i18n';

const STATUS_TONE = { active: 'gold', completed: 'positive', archived: 'neutral' } as const;

/** Freelance/client projects (§Phase 11) — what invoices and billable expenses attach to. */
export function ProjectsPage() {
  const t = useT();
  const { data: projects = [], isLoading, isError, error, refetch } = useProjects();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectDto | null>(null);
  const [viewing, setViewing] = useState<ProjectDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.projects')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('invoicing.clientsBillableExpensesAndProfitPer')}</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('invoicing.newProject')}
        </Button>
      </header>

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={4} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="size-5" />}
            title={t('invoicing.noProjectsYet')}
            description={t('invoicing.createAProjectToTrackBillable')}
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('invoicing.createYourFirstProject')}
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => setViewing(project)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-sunken sm:px-6"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{project.name}</span>
                    {project.personName && <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">{project.personName}</span>}
                  </span>
                  <Badge tone={STATUS_TONE[project.status]}>{project.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ProjectFormSheet open={creating} project={null} onClose={() => setCreating(false)} />
      <ProjectFormSheet
        open={Boolean(editing)}
        project={editing}
        onClose={() => {
          setEditing(null);
          setViewing(null);
        }}
      />
      <ProjectDetailSheet
        open={Boolean(viewing) && !editing}
        project={viewing}
        onClose={() => setViewing(null)}
        onEdit={() => setEditing(viewing)}
      />
    </div>
  );
}
