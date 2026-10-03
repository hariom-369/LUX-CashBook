import { useState } from 'react';
import { GitMerge, Pencil, Tag as TagIcon, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { ConfirmDialog, Sheet } from '../../components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useInvalidateOrganise, useTags } from '../../lib/queries5';
import { useT } from '../../i18n';

/**
 * Tag management (§Phase 2): see every tag with how often and how much it is used, rename one,
 * merge several into one, or remove one. A tag is only a label - none of this touches an amount.
 */
export function TagsSettings() {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateOrganise();
  const { data: tags = [], isLoading, isError, error, refetch } = useTags();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function toggle(tag: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      invalidate();
      toast.success(done);
      setRenaming(null);
      setMerging(false);
      setDeleting(null);
      setSelected(new Set());
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[13.5px] font-medium text-ink">{t('tags.title')}</p>
          <p className="mt-1 text-[12px] text-ink-muted">{t('tags.subtitle')}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<GitMerge className="size-3.5" />}
          disabled={selected.size < 2}
          onClick={() => {
            setName([...selected][0] ?? '');
            setProblem(null);
            setMerging(true);
          }}
        >
          {t('tags.mergeSelected', { count: selected.size })}
        </Button>
      </div>

      {isLoading ? (
        <LoadingState rows={4} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : tags.length === 0 ? (
        <EmptyState icon={<TagIcon className="size-5" />} title={t('tags.noneYet')} description={t('tags.noneYetHint')} />
      ) : (
        <ul className="flex flex-col divide-y divide-line-faint rounded-lg border border-line">
          {tags.map((tag) => (
            <li key={tag.tag} className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={selected.has(tag.tag)}
                onChange={() => toggle(tag.tag)}
                aria-label={t('tags.select', { tag: tag.tag })}
                className="size-4 shrink-0 rounded-sm border-line text-gold"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">#{tag.tag}</span>
                <span className="block text-[11.5px] text-ink-muted">{t.plural('tags.entries', tag.transactionCount)}</span>
              </span>
              <span className="hidden shrink-0 text-right sm:block">
                {tag.expenseMinor > 0 && <Money amountMinor={tag.expenseMinor} size="sm" tone="negative" compactDecimals />}
              </span>
              <button
                type="button"
                onClick={() => {
                  setName(tag.tag);
                  setProblem(null);
                  setRenaming(tag.tag);
                }}
                aria-label={t('tags.rename', { tag: tag.tag })}
                className="rounded-md p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
              >
                <Pencil aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setProblem(null);
                  setDeleting(tag.tag);
                }}
                aria-label={t('tags.remove', { tag: tag.tag })}
                className="rounded-md p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-negative"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={t('tags.renameTitle', { tag: renaming ?? '' })}
        description={t('tags.renameHint')}
        size="sm"
        busy={busy}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.post('/tags/rename', { from: renaming, to: name }), t('tags.renamed'));
          }}
        >
          <Field label={t('tags.newName')} error={problem ?? undefined}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-describedby={describedBy} aria-invalid={invalid} autoFocus />
            )}
          </Field>
          <Button type="submit" variant="gold" loading={busy} disabled={!name.trim() || name.trim().toLowerCase() === renaming}>
            {t('tags.renameAction')}
          </Button>
        </form>
      </Sheet>

      <Sheet open={merging} onClose={() => setMerging(false)} title={t('tags.mergeTitle', { count: selected.size })} description={t('tags.mergeHint')} size="sm" busy={busy}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.post('/tags/merge', { sources: [...selected], target: name }), t('tags.merged'));
          }}
        >
          <p className="text-[12.5px] text-ink-secondary">{[...selected].map((tag) => `#${tag}`).join(', ')}</p>
          <Field label={t('tags.mergeInto')} error={problem ?? undefined}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-describedby={describedBy} aria-invalid={invalid} autoFocus />
            )}
          </Field>
          <Button type="submit" variant="gold" loading={busy} disabled={!name.trim()}>
            {t('tags.mergeAction')}
          </Button>
        </form>
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={() => run(() => api.post('/tags/delete', { tag: deleting }), t('tags.removed'))}
        title={t('tags.removeTitle', { tag: deleting ?? '' })}
        description={t('tags.removeHint')}
        confirmLabel={t('common.remove')}
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
