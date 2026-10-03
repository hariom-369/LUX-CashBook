import { useRef, useState } from 'react';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, toDateKey, type DocumentType } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

/** Adds a standalone document to the vault — a warranty, insurance policy, rent agreement — not tied to any transaction. */
export function DocumentUploadSheet({ open, onClose, onUploaded }: { open: boolean; onClose: () => void; onUploaded: () => void }) {
  const tr = useT();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocumentType>('other');
  const [expiryDate, setExpiryDate] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null);
    setTitle('');
    setDocType('other');
    setExpiryDate('');
    setTags('');
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('docType', docType);
      if (title.trim()) form.append('title', title.trim());
      if (expiryDate) form.append('expiryDate', new Date(`${expiryDate}T12:00:00`).toISOString());
      if (tags.trim()) form.append('tags', tags.trim());
      await api.post('/attachments', form);
      toast.success(tr('documents.documentAdded'));
      reset();
      onUploaded();
      onClose();
    } catch (err) {
      toast.error(tr('documents.couldNotAddThatDocument'), err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={tr('documents.addADocument')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!file} onClick={() => void submit()}>
            {tr('common.add')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          tabIndex={-1}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
          {file ? file.name : tr('documents.chooseAFile')}
        </Button>

        <Field label={tr('reminders.form.type')}>
          {({ id }) => (
            <Select id={id} value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {tr.label('docType', t, DOCUMENT_TYPE_LABELS[t])}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={tr('documents.title')} hint={tr('documents.optionalDefaultsToTheFileName')}>
          {({ id }) => <Input id={id} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={tr('documents.fridgeWarranty')} />}
        </Field>

        <Field label={tr('documents.expiryDate')} hint={tr('documents.optionalRaisesAReminder14Days')}>
          {({ id }) => <Input id={id} type="date" value={expiryDate} min={toDateKey(new Date())} onChange={(e) => setExpiryDate(e.target.value)} />}
        </Field>

        <Field label={tr('common.tags')} hint={tr('documents.optionalCommaSeparated')}>
          {({ id }) => <Input id={id} value={tags} onChange={(e) => setTags(e.target.value)} placeholder={tr('documents.kitchenAppliance')} />}
        </Field>
      </div>
    </Sheet>
  );
}
