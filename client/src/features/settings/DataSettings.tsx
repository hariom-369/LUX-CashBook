import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FileUp, HardDriveDownload, HardDriveUpload, Undo2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { Sheet } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { downloadFile } from '../../lib/download';
import { api, errorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import { DataHealthSection } from './DataHealthSection';
import { useT } from '../../i18n';

interface ImportPreviewRow {
  row: number;
  date: string;
  amountMinor: number;
  accountName: string;
  description: string;
  isValid: boolean;
  errors: string[];
}

interface ImportPreview {
  rows: ImportPreviewRow[];
  validCount: number;
  errorCount: number;
}

/**
 * Data settings (§34, §40).
 *
 * Export, import and backup are grouped together because they're the same
 * underlying promise — "your data is never trapped in this application" — seen
 * from three angles: a spreadsheet, a full portable file, and a way back in.
 */
export function DataSettings() {
  return (
    <div className="flex flex-col gap-8">
      <ExportSection />
      <ImportSection />
      <BackupSection />
      <DataHealthSection />
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">{description}</p>
    </div>
  );
}

function ExportSection() {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function exportTransactions() {
    setBusy('transactions');
    try {
      await downloadFile('/import-export/transactions.csv');
      toast.success(t('settings.exportStarted'));
    } catch (err) {
      toast.error(t('settings.couldNotExport'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <SectionHeader title={t('settings.export')} description={t('settings.downloadYourTransactionsAsASpreadsheet')} />
      <div className="mt-4">
        <Button variant="secondary" size="sm" loading={busy === 'transactions'} leftIcon={<Download className="size-3.5" />} onClick={() => void exportTransactions()}>
          {t('settings.exportAllTransactionsCsv')}
        </Button>
      </div>
    </section>
  );
}

function ImportSection() {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; importBatchId: string } | null>(null);

  async function downloadTemplate() {
    try {
      await downloadFile('/import-export/template');
    } catch (err) {
      toast.error(t('settings.couldNotDownloadTheTemplate'), errorMessage(err));
    }
  }

  async function choosePreview(selected: File) {
    setFile(selected);
    setPreview(null);
    setResult(null);
    setBusy('preview');
    try {
      const form = new FormData();
      form.append('file', selected);
      const data = await api.post<ImportPreview>('/import-export/preview', form);
      setPreview(data);
    } catch (err) {
      toast.error(t('common.couldNotReadThatFile'), errorMessage(err));
      setFile(null);
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!file) return;
    setBusy('commit');
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api.post<{ imported: number; skipped: number; importBatchId: string }>('/import-export/commit', form);
      setResult(data);
      setPreview(null);
      setFile(null);
      await queryClient.invalidateQueries();
      toast.success(t('settings.importedTransactions', { imported: data.imported }), data.skipped > 0 ? t('settings.rowsSkipped', { count: data.skipped }) : undefined);
    } catch (err) {
      toast.error(t('settings.importFailed'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function undo() {
    if (!result) return;
    setBusy('commit');
    try {
      await api.post(`/import-export/undo/${result.importBatchId}`);
      await queryClient.invalidateQueries();
      toast.success(t('settings.importUndone'));
      setResult(null);
    } catch (err) {
      toast.error(t('settings.couldNotUndoThatImport'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border-t border-line-faint pt-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <SectionHeader title={t('settings.import')} description={t('settings.bringTransactionsInFromACsv')} />
        <button type="button" onClick={() => void downloadTemplate()} className="shrink-0 text-[12px] font-medium text-gold underline-offset-4 hover:underline">
          {t('settings.downloadTemplate')}
        </button>
      </div>

      <div className="mt-4">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void choosePreview(selected);
            event.target.value = '';
          }}
        />
        <Button variant="secondary" size="sm" loading={busy === 'preview'} leftIcon={<FileUp className="size-3.5" />} onClick={() => fileRef.current?.click()}>
          {t('settings.chooseCsvFile')}
        </Button>
      </div>

      {preview && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 basis-48 text-[13px] font-medium text-ink">
              {t.plural('settings.rowsReady', preview.validCount)}
              {preview.errorCount > 0 && <span className="text-negative"> · {preview.errorCount} {t('settings.willBeSkipped')}</span>}
            </p>
            <Button size="sm" variant="gold" loading={busy === 'commit'} disabled={preview.validCount === 0} onClick={() => void commit()}>
              {t.plural('settings.importRows', preview.validCount)}
            </Button>
          </div>

          {preview.errorCount > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-line-faint pt-3">
              {preview.rows.filter((r) => !r.isValid).slice(0, 8).map((row) => (
                <li key={row.row} className="flex items-start gap-2 text-[11.5px] text-ink-muted">
                  <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0 text-negative" />
                  <span>
                    {t('settings.row2')} {row.row}: {row.errors.join(' ')}
                  </span>
                </li>
              ))}
              {preview.errorCount > 8 && (
                <li className="text-[11.5px] text-ink-faint">{t('settings.and')} {preview.errorCount - 8} {t('settings.more')}</li>
              )}
            </ul>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-positive/25 bg-positive-soft p-4">
          <p className="min-w-0 flex-1 basis-48 text-[13px] text-ink-secondary">
            {t.plural('settings.importedCount', result.imported)}
            {result.skipped > 0 ? t('settings.skippedSuffix', { count: result.skipped }) : ''}.
          </p>
          <Button size="sm" variant="ghost" leftIcon={<Undo2 className="size-3.5" />} loading={busy === 'commit'} onClick={() => void undo()}>
            {t('settings.undo')}
          </Button>
        </div>
      )}
    </section>
  );
}

function BackupSection() {
  const t = useT();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const workspaces = useAuthStore((s) => s.workspaces);
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<File | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  async function exportBackup() {
    setBusy('export');
    try {
      await downloadFile('/backup');
      toast.success(t('settings.backupDownloaded'), t('settings.keepItSomewhereSafeItContains'));
    } catch (err) {
      toast.error(t('settings.couldNotCreateABackup'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    if (!confirmRestore) return;
    setBusy('restore');
    try {
      const form = new FormData();
      form.append('file', confirmRestore);
      if (newWorkspaceName.trim()) form.append('workspaceName', newWorkspaceName.trim());
      await api.post('/backup/restore', form);
      toast.success(t('settings.backupRestored'), t('settings.itWasAddedAsANew'));
      window.location.reload();
    } catch (err) {
      toast.error(t('settings.couldNotRestoreThatBackup'), errorMessage(err));
    } finally {
      setBusy(null);
      setConfirmRestore(null);
    }
  }

  return (
    <>
      <section className="border-t border-line-faint pt-6">
        <SectionHeader title={t('settings.backupRestore')} description={t('settings.aCompletePortableCopyOfOne')} />

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={busy === 'export'} leftIcon={<HardDriveDownload className="size-3.5" />} onClick={() => void exportBackup()}>
            {t('settings.downloadBackup')}
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) {
                setNewWorkspaceName('');
                setConfirmRestore(selected);
              }
              event.target.value = '';
            }}
          />
          <Button variant="secondary" size="sm" leftIcon={<HardDriveUpload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
            {t('settings.restoreFromBackup')}
          </Button>
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
          {t('settings.restoringAlwaysCreatesABrandNew')} {workspaces.length > 1 ? t('settings.anyOfYourExistingWorkspaces') : t('settings.yourExistingData')}.
        </p>
      </section>

      <Sheet
        open={Boolean(confirmRestore)}
        onClose={() => setConfirmRestore(null)}
        title={t('settings.restoreThisBackup')}
        description={t('settings.itWillBeAddedAsA')}
        size="sm"
        busy={busy === 'restore'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmRestore(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="gold" loading={busy === 'restore'} onClick={() => void restore()}>
              {t('common.restore')}
            </Button>
          </div>
        }
      >
        <Field label={t('settings.nameThisWorkspace')} hint={t('settings.defaultsToTheOriginalNameWith')}>
          {({ id }) => (
            <Input
              id={id}
              value={newWorkspaceName}
              maxLength={60}
              placeholder={confirmRestore ? confirmRestore.name.replace(/\.json$/i, '') : ''}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
            />
          )}
        </Field>
      </Sheet>
    </>
  );
}
