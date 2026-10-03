import { useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { IMPORT_DATE_FORMATS, type BankImportRow, type ImportColumnMapping } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Select } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { useInvalidateLedger } from '../../lib/queries';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT, msg, type MessageRef } from '../../i18n';
import { ScrollRegion } from '../../components/ui/ScrollRegion';

type Step = 'upload' | 'map' | 'preview';

const FIELD_LABELS: Array<{ key: keyof ImportColumnMapping; label: MessageRef; required: boolean }> = [
  { key: 'date', label: msg('common.date'), required: true },
  { key: 'description', label: msg('common.description'), required: true },
  { key: 'amount', label: msg('accounts.amountSigned'), required: false },
  { key: 'debit', label: msg('accounts.debitWithdrawal'), required: false },
  { key: 'credit', label: msg('accounts.creditDeposit'), required: false },
  { key: 'reference', label: msg('accounts.referenceNumber'), required: false },
];

/**
 * Bank statement import wizard (docs/PRODUCT_AUDIT.md D-3, Phase 5).
 *
 * Three steps: upload + choose the account and date format; map this bank's
 * columns onto what Khata needs; review a classified preview (new / possible
 * duplicate / duplicate / invalid) and choose, row by row, what to do before
 * anything is committed. Nothing is imported blindly.
 */
export function ImportWizard({ accountId, open, onClose }: { accountId: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateLedger();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [dateFormat, setDateFormat] = useState<(typeof IMPORT_DATE_FORMATS)[number]>('dd/mm/yyyy');
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<ImportColumnMapping>>({});
  const [rows, setRows] = useState<BankImportRow[]>([]);
  const [selected, setSelected] = useState<Record<number, 'import' | 'match' | 'skip'>>({});
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep('upload');
    setFile(null);
    setHeaders([]);
    setSampleRows([]);
    setMapping({});
    setRows([]);
    setSelected({});
  }

  async function chooseFile(picked: File) {
    setFile(picked);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', picked);
      const res = await api.post<{ headers: string[]; sampleRows: Record<string, string>[] }>('/bank-import/parse', form);
      setHeaders(res.headers);
      setSampleRows(res.sampleRows);
      setStep('map');
    } catch (err) {
      toast.error(t('common.couldNotReadThatFile'), err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!file || !mapping.date || !mapping.description) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('accountId', accountId);
      form.append('dateFormat', dateFormat);
      form.append('mapping', JSON.stringify(mapping));
      const res = await api.post<{ rows: BankImportRow[] }>('/bank-import/preview', form);
      setRows(res.rows);
      setSelected(
        Object.fromEntries(res.rows.map((r) => [r.rowNumber, r.status === 'new' ? 'import' : r.status === 'invalid' ? 'skip' : 'skip'])),
      );
      setStep('preview');
    } catch (err) {
      toast.error(t('accounts.couldNotPreviewThatImport'), err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('accountId', accountId);
      form.append('dateFormat', dateFormat);
      form.append('mapping', JSON.stringify(mapping));
      const importRowNumbers = Object.entries(selected).filter(([, v]) => v === 'import').map(([k]) => Number(k));
      const matchRowNumbers = Object.entries(selected).filter(([, v]) => v === 'match').map(([k]) => Number(k));
      form.append('selection', JSON.stringify({ importRowNumbers, matchRowNumbers }));
      const result = await api.post<{ imported: number; matched: number; skipped: number }>('/bank-import/commit', form);
      invalidate();
      toast.success(t('accounts.importComplete'), t('accounts.addedMatchedToExistingEntriesSkipped', { imported: result.imported, matched: result.matched, skipped: result.skipped }));
      reset();
      onClose();
    } catch (err) {
      toast.error(t('accounts.couldNotCompleteThatImport'), err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const canPreview = Boolean(mapping.date && mapping.description && (mapping.amount || mapping.debit || mapping.credit));

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('accounts.importABankStatement')}
      size="lg"
      busy={busy}
    >
      {step === 'upload' && (
        <div className="flex flex-col gap-4">
          <Field label={t('accounts.dateFormatInThisFile')} required>
            {({ id }) => (
              <Select id={id} value={dateFormat} onChange={(e) => setDateFormat(e.target.value as typeof dateFormat)}>
                {IMPORT_DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            tabIndex={-1}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) void chooseFile(picked);
            }}
          />
          <Button variant="gold" loading={busy} onClick={() => fileRef.current?.click()}>
            {t('accounts.chooseACsvFile')}
          </Button>
          <p className="text-[12px] text-ink-muted">{t('accounts.exportYourStatementAsCsvFrom')}</p>
        </div>
      )}

      {step === 'map' && (
        <div className="flex flex-col gap-4">
          <button type="button" onClick={() => setStep('upload')} className="flex w-fit items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
            <ChevronLeft className="size-3.5" /> {t('common.back')}
          </button>
          <p className="text-[12px] text-ink-muted">{t('accounts.matchThisStatementSColumnsTo')}</p>
          {FIELD_LABELS.map(({ key, label, required }) => (
            <Field key={key} label={t(label.key)} required={required}>
              {({ id }) => (
                <Select id={id} value={mapping[key] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value || undefined }))}>
                  <option value="">{t('accounts.notInThisFile')}</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
          {sampleRows.length > 0 && (
            <ScrollRegion label={t('scroll.importPreview')} className="rounded-md border border-line-faint">
              <table className="w-full text-left text-[11.5px]">
                <thead>
                  <tr className="bg-sunken/60">
                    {headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium text-ink-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.slice(0, 3).map((row, i) => (
                    <tr key={i} className="border-t border-line-faint">
                      {headers.map((h) => (
                        <td key={h} className="whitespace-nowrap px-2 py-1.5 text-ink-muted">
                          {row[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          <Button variant="gold" disabled={!canPreview} loading={busy} onClick={() => void preview()}>
            {t('accounts.previewImport')}
          </Button>
        </div>
      )}

      {step === 'preview' && (
        <div className="flex flex-col gap-3">
          <button type="button" onClick={() => setStep('map')} className="flex w-fit items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
            <ChevronLeft className="size-3.5" /> {t('common.back')}
          </button>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.rowNumber} className="flex flex-wrap items-center gap-2 rounded-md border border-line-faint px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12.5px] text-ink">{row.description || '(no description)'}</span>
                    <Badge
                      eyebrow
                      tone={row.status === 'new' ? 'positive' : row.status === 'invalid' ? 'negative' : row.status === 'duplicate' ? 'outline' : 'warning'}
                    >
                      {row.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  {row.matchReason && <p className="mt-0.5 text-[11px] text-ink-muted">{row.matchReason}</p>}
                  {row.errors.length > 0 && <p className="mt-0.5 text-[11px] text-negative">{row.errors.join(' ')}</p>}
                </div>
                {row.amountMinor !== undefined && (
                  <Money amountMinor={row.amountMinor} size="sm" tone={row.amountMinor >= 0 ? 'positive' : 'negative'} signed compactDecimals />
                )}
                <Select
                  aria-label={t('accounts.actionForRow', { rowNumber: row.rowNumber })}
                  className="w-auto min-w-[9rem]"
                  value={selected[row.rowNumber] ?? 'skip'}
                  disabled={row.status === 'invalid'}
                  onChange={(e) => setSelected((s) => ({ ...s, [row.rowNumber]: e.target.value as 'import' | 'match' | 'skip' }))}
                >
                  <option value="import">{t('accounts.importAsNew')}</option>
                  {row.matchedTransactionId && <option value="match">{t('accounts.markAsAlreadyRecorded')}</option>}
                  <option value="skip">{t('accounts.skip')}</option>
                </Select>
              </li>
            ))}
          </ul>
          <Button variant="gold" loading={busy} onClick={() => void commit()}>
            {t('accounts.completeImport')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
