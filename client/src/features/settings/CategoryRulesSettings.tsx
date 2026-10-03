import { useState } from 'react';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { ConfirmDialog, Sheet } from '../../components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useCategories } from '../../lib/queries';
import { useCategoryRules, useInvalidateOrganise } from '../../lib/queries5';
import { useT } from '../../i18n';

/**
 * Category rules (§Phase 2): "if the description contains Jio, suggest Telecom". A rule only ever
 * *suggests* while an entry is being typed - it never changes an entry that already exists.
 */
export function CategoryRulesSettings() {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateOrganise();
  const { data: rules = [], isLoading, isError, error, refetch } = useCategoryRules();
  const { data: categories = [] } = useCategories();

  const [adding, setAdding] = useState(false);
  const [pattern, setPattern] = useState('');
  const [field, setField] = useState<'description' | 'payee'>('description');
  const [categoryId, setCategoryId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const usable = categories.filter((c) => !c.isArchived);

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/category-rules', { pattern, field, categoryId });
      invalidate();
      toast.success(t('rules.added'));
      setAdding(false);
      setPattern('');
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/category-rules/${deleting}`);
      invalidate();
      toast.success(t('rules.removed'));
    } catch (err) {
      toast.error(t('rules.couldNotRemove'), errorMessage(err));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[13.5px] font-medium text-ink">{t('rules.title')}</p>
          <p className="mt-1 text-[12px] text-ink-muted">{t('rules.subtitle')}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Plus className="size-3.5" />}
          onClick={() => {
            setProblem(null);
            setCategoryId(usable[0]?.id ?? '');
            setAdding(true);
          }}
        >
          {t('rules.add')}
        </Button>
      </div>

      {isLoading ? (
        <LoadingState rows={3} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : rules.length === 0 ? (
        <EmptyState icon={<ListChecks className="size-5" />} title={t('rules.noneYet')} description={t('rules.noneYetHint')} />
      ) : (
        <ul className="flex flex-col divide-y divide-line-faint rounded-lg border border-line">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">
                  <span className="text-ink-muted">{rule.field === 'payee' ? t('rules.payeeContains') : t('rules.descriptionContains')}</span>{' '}
                  <strong className="font-medium">&ldquo;{rule.pattern}&rdquo;</strong>
                  {' → '}
                  {rule.categoryName}
                </span>
                <span className="block text-[11.5px] text-ink-muted">{t.plural('rules.accepted', rule.hits)}</span>
              </span>
              {rule.hits >= 3 && <Badge tone="positive" eyebrow>{t('rules.trusted')}</Badge>}
              <button
                type="button"
                onClick={() => setDeleting(rule.id)}
                aria-label={t('rules.remove', { pattern: rule.pattern })}
                className="rounded-md p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-negative"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('rules.add')} description={t('rules.addHint')} size="sm" busy={busy}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label={t('rules.lookIn')}>
            {({ id }) => (
              <Select id={id} value={field} onChange={(e) => setField(e.target.value as 'description' | 'payee')}>
                <option value="description">{t('rules.inDescription')}</option>
                <option value="payee">{t('rules.inPayee')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('rules.textToFind')} hint={t('rules.textToFindHint')} error={problem ?? undefined} required>
            {({ id, describedBy, invalid }) => (
              <Input id={id} value={pattern} onChange={(e) => setPattern(e.target.value)} maxLength={60} aria-describedby={describedBy} aria-invalid={invalid} autoFocus />
            )}
          </Field>
          <Field label={t('rules.suggestCategory')} required>
            {({ id }) => (
              <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {usable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" variant="gold" loading={busy} disabled={pattern.trim().length < 2 || !categoryId}>
            {t('rules.save')}
          </Button>
        </form>
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        title={t('rules.removeTitle')}
        description={t('rules.removeHint')}
        confirmLabel={t('common.remove')}
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
