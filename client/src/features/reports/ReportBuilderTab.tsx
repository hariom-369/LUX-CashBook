import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, Save, Trash2 } from 'lucide-react';
import { RANGE_PRESETS, type ReportDefinition, type ReportGroupBy, type ReportResultDto, type SavedReportDto } from '@khata/shared';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { ConfirmDialog, Sheet } from '../../components/ui/Sheet';
import { ScrollRegion } from '../../components/ui/ScrollRegion';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { useAccounts, useCategories } from '../../lib/queries';
import { runReportDefinition, useInvalidateOrganise, useSavedReports } from '../../lib/queries5';
import { useAuthStore } from '../../stores/auth.store';
import { useT } from '../../i18n';

/**
 * The report builder (§Phase 7): choose a period, optional filters and a grouping; see the result as a
 * table, bars or a summary; save, duplicate and export it. Every choice is an item from a fixed list the
 * server also enforces, so the builder can only ask questions the ledger can answer exactly.
 */
const GROUPINGS: ReportGroupBy[] = ['category', 'account', 'payee', 'person', 'tag', 'month', 'day', 'type'];
const RANGES = RANGE_PRESETS.filter((r) => r !== 'custom');

export const DEFAULT_DEFINITION: ReportDefinition = { range: 'last_3_months', groupBy: 'category', view: 'table' };

/** Drop empty optional filters so the stored definition and the request stay minimal. */
export function cleanDefinition(d: ReportDefinition): ReportDefinition {
  const out: ReportDefinition = { range: d.range, groupBy: d.groupBy, view: d.view };
  if (d.types?.length) out.types = d.types;
  if (d.accountIds?.length) out.accountIds = d.accountIds;
  if (d.categoryIds?.length) out.categoryIds = d.categoryIds;
  if (d.tags?.length) out.tags = d.tags;
  if (d.minAmountMinor !== undefined) out.minAmountMinor = d.minAmountMinor;
  if (d.maxAmountMinor !== undefined) out.maxAmountMinor = d.maxAmountMinor;
  return out;
}

export function ReportBuilderTab() {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateOrganise();
  const ws = useAuthStore((s) => s.activeWorkspaceId);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: saved = [] } = useSavedReports();

  const [definition, setDefinition] = useState<ReportDefinition>(DEFAULT_DEFINITION);
  const [tagText, setTagText] = useState('');
  const [loaded, setLoaded] = useState<SavedReportDto | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = useMemo(() => cleanDefinition({ ...definition, tags: tagText.trim() ? [tagText.trim().toLowerCase()] : undefined }), [definition, tagText]);
  // How it is shown (table / bars / summary) does not change the numbers, so it is not part of what is asked.
  const asked = useMemo(() => ({ ...request, view: 'table' as const }), [request]);
  const { data: result, isLoading, isError, error, refetch } = useQuery({
    queryKey: [ws, 'report-builder', asked],
    queryFn: () => runReportDefinition(asked),
    enabled: Boolean(ws),
  });

  const set = (patch: Partial<ReportDefinition>) => {
    setDefinition((d) => ({ ...d, ...patch }));
  };

  function load(id: string) {
    const found = saved.find((s) => s.id === id) ?? null;
    setLoaded(found);
    if (found) {
      setDefinition({ ...DEFAULT_DEFINITION, ...found.definition });
      setTagText(found.definition.tags?.[0] ?? '');
    }
  }

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      invalidate();
      toast.success(done);
    } catch (err) {
      toast.error(t('builder.failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const accountLabel = accounts.find((a) => a.id === definition.accountIds?.[0])?.name;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader eyebrow={t('builder.eyebrow')} title={t('builder.title')} />
        <p className="mt-1 text-[12.5px] text-ink-muted">{t('builder.hint')}</p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('builder.period')}>
            {({ id }) => (
              <Select id={id} value={definition.range} onChange={(e) => set({ range: e.target.value as ReportDefinition['range'] })}>
                {RANGES.map((r) => (
                  <option key={r} value={r}>
                    {t.label('range', r, r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('builder.groupBy')}>
            {({ id }) => (
              <Select id={id} value={definition.groupBy} onChange={(e) => set({ groupBy: e.target.value as ReportGroupBy })}>
                {GROUPINGS.map((g) => (
                  <option key={g} value={g}>
                    {t(`builder.group.${g}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('builder.show')}>
            {({ id }) => (
              <Select id={id} value={definition.view} onChange={(e) => set({ view: e.target.value as ReportDefinition['view'] })}>
                <option value="table">{t('builder.view.table')}</option>
                <option value="chart">{t('builder.view.chart')}</option>
                <option value="summary">{t('builder.view.summary')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('common.account')}>
            {({ id }) => (
              <Select id={id} value={definition.accountIds?.[0] ?? ''} onChange={(e) => set({ accountIds: e.target.value ? [e.target.value] : undefined })}>
                <option value="">{t('builder.any')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('common.category')}>
            {({ id }) => (
              <Select id={id} value={definition.categoryIds?.[0] ?? ''} onChange={(e) => set({ categoryIds: e.target.value ? [e.target.value] : undefined })}>
                <option value="">{t('builder.any')}</option>
                {categories.filter((c) => !c.isArchived).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('builder.tag')}>
            {({ id }) => <Input id={id} value={tagText} onChange={(e) => setTagText(e.target.value)} maxLength={40} placeholder={t('builder.any')} />}
          </Field>
          <Field label={t('builder.kind')}>
            {({ id }) => (
              <Select
                id={id}
                value={definition.types?.length === 1 ? definition.types[0] : ''}
                onChange={(e) => set({ types: e.target.value ? [e.target.value as 'income' | 'expense'] : undefined })}
              >
                <option value="">{t('builder.incomeAndExpense')}</option>
                <option value="expense">{t('common.expenses')}</option>
                <option value="income">{t('common.income')}</option>
              </Select>
            )}
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-line-faint pt-4">
          <Field label={t('builder.saved')} className="min-w-[200px] flex-1 sm:flex-none">
            {({ id }) => (
              <Select id={id} value={loaded?.id ?? ''} onChange={(e) => load(e.target.value)}>
                <option value="">{t('builder.unsaved')}</option>
                {saved.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Save className="size-3.5" />}
            onClick={() => {
              setName(loaded?.name ?? '');
              setNaming(true);
            }}
          >
            {loaded ? t('builder.update') : t('builder.save')}
          </Button>
          {loaded && (
            <>
              <Button size="sm" variant="ghost" leftIcon={<Copy className="size-3.5" />} loading={busy} onClick={() => void act(async () => setLoaded(await api.post<SavedReportDto>(`/saved-reports/${loaded.id}/duplicate`)), t('builder.duplicated'))}>
                {t('builder.duplicate')}
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>
                {t('common.delete')}
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Download className="size-3.5" />}
            onClick={() => void act(() => downloadFile('/reports/custom/export', undefined, { method: 'POST', body: { definition: request } }), t('builder.exported'))}
          >
            {t('builder.export')}
          </Button>
        </div>
      </Card>

      {isLoading ? (
        <Card>
          <LoadingState rows={4} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : result ? (
        <ReportResult result={result} view={definition.view} accountLabel={accountLabel} />
      ) : null}

      <Sheet open={naming} onClose={() => setNaming(false)} title={loaded ? t('builder.update') : t('builder.save')} size="sm" busy={busy}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const saved = loaded
                ? await api.patch<SavedReportDto>(`/saved-reports/${loaded.id}`, { name, definition: request })
                : await api.post<SavedReportDto>('/saved-reports', { name, definition: request });
              setLoaded(saved);
              setNaming(false);
            }, t('builder.savedToast'));
          }}
        >
          <Field label={t('builder.name')} required>
            {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />}
          </Field>
          <Button type="submit" variant="gold" loading={busy} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </form>
      </Sheet>

      <ConfirmDialog
        open={deleting}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          if (!loaded) return;
          await act(async () => {
            await api.delete(`/saved-reports/${loaded.id}`);
            setLoaded(null);
          }, t('builder.deleted'));
          setDeleting(false);
        }}
        title={t('builder.deleteTitle', { name: loaded?.name ?? '' })}
        description={t('builder.deleteHint')}
        confirmLabel={t('common.delete')}
        tone="danger"
        busy={busy}
      />
    </div>
  );
}

function ReportResult({ result, view, accountLabel }: { result: ReportResultDto; view: ReportDefinition['view']; accountLabel?: string }) {
  const t = useT();
  const { rows, totals, definition } = result;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.expenseMinor, r.incomeMinor)));
  const top = rows[0];

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title={t('builder.nothing')} description={t('builder.nothingHint')} />
      </Card>
    );
  }

  return (
    <Card bare>
      <div className="p-5 pb-3 sm:p-6 sm:pb-3">
        <CardHeader eyebrow={t(`builder.group.${definition.groupBy}`)} title={t('builder.result')} />
        <p role="status" className="mt-1 text-[12.5px] text-ink-muted">
          {t.plural('builder.entries', totals.count)}
          {accountLabel ? ` · ${accountLabel}` : ''}
          {result.overlapping ? ` · ${t('builder.overlapping')}` : ''}
          {result.truncated ? ` · ${t('builder.truncated')}` : ''}
        </p>
      </div>

      {view === 'summary' && (
        <dl className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-3 sm:px-6">
          <SummaryTile label={t('common.income')} amountMinor={totals.incomeMinor} tone="positive" />
          <SummaryTile label={t('common.expenses')} amountMinor={totals.expenseMinor} tone="negative" />
          <SummaryTile label={t('common.net')} amountMinor={totals.netMinor} tone={totals.netMinor >= 0 ? 'positive' : 'negative'} />
          {top && (
            <div className="sm:col-span-3">
              <dt className="label-eyebrow">{t('builder.top')}</dt>
              <dd className="mt-1 text-[13px] text-ink">
                {top.label} · <Money amountMinor={Math.max(top.expenseMinor, top.incomeMinor)} size="sm" tone="neutral" compactDecimals />
              </dd>
            </div>
          )}
        </dl>
      )}

      {view === 'chart' && (
        <ul className="flex flex-col gap-2.5 px-5 pb-5 sm:px-6">
          {rows.slice(0, 20).map((row) => (
            <li key={row.key || row.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[12.5px]">
              <span className="truncate text-ink-secondary">{row.label}</span>
              <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-sunken">
                <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.round((Math.max(row.expenseMinor, row.incomeMinor) / max) * 100)}%` }} />
              </span>
              <Money amountMinor={Math.max(row.expenseMinor, row.incomeMinor)} size="sm" tone="neutral" compactDecimals />
            </li>
          ))}
        </ul>
      )}

      {/* The table is always present: it is the exact answer, and the accessible one, whichever view is chosen. */}
      <ScrollRegion label={t('builder.result')} className="border-t border-line-faint">
        <table className="w-full min-w-[520px] text-left">
          <caption className="sr-only">{t('builder.result')}</caption>
          <thead>
            <tr className="border-b border-line bg-sunken/60">
              <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">{t(`builder.group.${definition.groupBy}`)}</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('common.income')}</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('common.expenses')}</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('common.net')}</th>
              <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6">{t('builder.entriesColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key || row.label} className="border-b border-line-faint last:border-0">
                <th scope="row" className="px-5 py-2.5 text-left text-[13px] font-normal text-ink sm:px-6">{row.label}</th>
                <td className="px-3 py-2.5 text-right"><Money amountMinor={row.incomeMinor} size="sm" tone="positive" compactDecimals /></td>
                <td className="px-3 py-2.5 text-right"><Money amountMinor={row.expenseMinor} size="sm" tone="negative" compactDecimals /></td>
                <td className="px-3 py-2.5 text-right"><Money amountMinor={row.netMinor} size="sm" tone={row.netMinor >= 0 ? 'positive' : 'negative'} compactDecimals /></td>
                <td className="px-5 py-2.5 text-right text-[12.5px] text-ink-muted sm:px-6">{row.count}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-sunken/60">
              <th scope="row" className="px-5 py-3 text-left text-[12.5px] font-semibold text-ink sm:px-6">{t('builder.total')}</th>
              <td className="px-3 py-3 text-right"><Money amountMinor={totals.incomeMinor} size="sm" tone="positive" compactDecimals /></td>
              <td className="px-3 py-3 text-right"><Money amountMinor={totals.expenseMinor} size="sm" tone="negative" compactDecimals /></td>
              <td className="px-3 py-3 text-right"><Money amountMinor={totals.netMinor} size="sm" tone={totals.netMinor >= 0 ? 'positive' : 'negative'} compactDecimals /></td>
              <td className="px-5 py-3 text-right text-[12.5px] text-ink-muted sm:px-6">{totals.count}</td>
            </tr>
          </tfoot>
        </table>
      </ScrollRegion>
    </Card>
  );
}

function SummaryTile({ label, amountMinor, tone }: { label: string; amountMinor: number; tone: 'positive' | 'negative' }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <dt className="label-eyebrow">{label}</dt>
      <dd className="mt-1.5">
        <Money amountMinor={amountMinor} size="lg" tone={tone} compactDecimals />
      </dd>
    </div>
  );
}
