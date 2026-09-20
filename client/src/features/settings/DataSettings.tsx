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
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function exportTransactions() {
    setBusy('transactions');
    try {
      await downloadFile('/import-export/transactions.csv');
      toast.success('Export started');
    } catch (err) {
      toast.error('Could not export', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <SectionHeader title="Export" description="Download your transactions as a spreadsheet you can open anywhere." />
      <div className="mt-4">
        <Button variant="secondary" size="sm" loading={busy === 'transactions'} leftIcon={<Download className="size-3.5" />} onClick={() => void exportTransactions()}>
          Export all transactions (CSV)
        </Button>
      </div>
    </section>
  );
}

function ImportSection() {
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
      toast.error('Could not download the template', errorMessage(err));
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
      toast.error('Could not read that file', errorMessage(err));
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
      toast.success(`Imported ${data.imported} transactions`, data.skipped > 0 ? `${data.skipped} rows were skipped.` : undefined);
    } catch (err) {
      toast.error('Import failed', errorMessage(err));
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
      toast.success('Import undone');
      setResult(null);
    } catch (err) {
      toast.error('Could not undo that import', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border-t border-line-faint pt-6">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader title="Import" description="Bring transactions in from a CSV — a bank statement export, or another app's data." />
        <button type="button" onClick={() => void downloadTemplate()} className="shrink-0 text-[12px] font-medium text-gold underline-offset-4 hover:underline">
          Download template
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
          Choose CSV file
        </Button>
      </div>

      {preview && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-ink">
              {preview.validCount} row{preview.validCount === 1 ? '' : 's'} ready to import
              {preview.errorCount > 0 && <span className="text-negative"> · {preview.errorCount} will be skipped</span>}
            </p>
            <Button size="sm" variant="gold" loading={busy === 'commit'} disabled={preview.validCount === 0} onClick={() => void commit()}>
              Import {preview.validCount} row{preview.validCount === 1 ? '' : 's'}
            </Button>
          </div>

          {preview.errorCount > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-line-faint pt-3">
              {preview.rows.filter((r) => !r.isValid).slice(0, 8).map((row) => (
                <li key={row.row} className="flex items-start gap-2 text-[11.5px] text-ink-muted">
                  <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0 text-negative" />
                  <span>
                    Row {row.row}: {row.errors.join(' ')}
                  </span>
                </li>
              ))}
              {preview.errorCount > 8 && (
                <li className="text-[11.5px] text-ink-faint">and {preview.errorCount - 8} more…</li>
              )}
            </ul>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-positive/25 bg-positive-soft p-4">
          <p className="text-[13px] text-ink-secondary">
            Imported {result.imported} transaction{result.imported === 1 ? '' : 's'}
            {result.skipped > 0 ? `, ${result.skipped} skipped` : ''}.
          </p>
          <Button size="sm" variant="ghost" leftIcon={<Undo2 className="size-3.5" />} loading={busy === 'commit'} onClick={() => void undo()}>
            Undo
          </Button>
        </div>
      )}
    </section>
  );
}

function BackupSection() {
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
      toast.success('Backup downloaded', 'Keep it somewhere safe — it contains your full ledger.');
    } catch (err) {
      toast.error('Could not create a backup', errorMessage(err));
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
      toast.success('Backup restored', 'It was added as a new workspace — nothing existing was changed.');
      window.location.reload();
    } catch (err) {
      toast.error('Could not restore that backup', errorMessage(err));
    } finally {
      setBusy(null);
      setConfirmRestore(null);
    }
  }

  return (
    <>
      <section className="border-t border-line-faint pt-6">
        <SectionHeader title="Backup & restore" description="A complete, portable copy of one workspace — every account, category, person and transaction." />

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={busy === 'export'} leftIcon={<HardDriveDownload className="size-3.5" />} onClick={() => void exportBackup()}>
            Download backup
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
            Restore from backup
          </Button>
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
          Restoring always creates a brand-new workspace — it never overwrites {workspaces.length > 1 ? 'any of your existing workspaces' : 'your existing data'}.
        </p>
      </section>

      <Sheet
        open={Boolean(confirmRestore)}
        onClose={() => setConfirmRestore(null)}
        title="Restore this backup?"
        description="It will be added as a new workspace — nothing existing is changed. The page reloads once it's done."
        size="sm"
        busy={busy === 'restore'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmRestore(null)}>
              Cancel
            </Button>
            <Button variant="gold" loading={busy === 'restore'} onClick={() => void restore()}>
              Restore
            </Button>
          </div>
        }
      >
        <Field label="Name this workspace" hint={`Defaults to the original name with "(Restored)" appended.`}>
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
