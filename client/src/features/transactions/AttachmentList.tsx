import { useRef, useState } from 'react';
import { FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import type { AttachmentDto } from '@khata/shared';
import { useToast } from '../../components/ui/Toast';
import { useInvalidateLedger } from '../../lib/queries';
import { useAuthedBlobUrl } from '../../hooks/useAuthedBlobUrl';
import { downloadFile } from '../../lib/download';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

/**
 * Receipts and documents on a transaction (§26).
 *
 * Upload, preview and delete, inline in the detail sheet rather than a separate
 * screen — a receipt is looked at in the context of the transaction it belongs to,
 * essentially always. Every thumbnail and download goes through the authenticated
 * fetch-then-blob path (`useAuthedBlobUrl`, `downloadFile`) rather than a raw
 * `<img src>` or `<a href>`, because the download endpoint requires the same
 * workspace-scoped auth as everything else (§69) and neither tag can carry it.
 */
export function AttachmentList({
  transactionId,
  attachments,
}: {
  transactionId: string;
  attachments: AttachmentDto[];
}) {
  const toast = useToast();
  const invalidate = useInvalidateLedger();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function upload(file: File) {
    if (attachments.length >= 10) {
      toast.error('Too many attachments', 'A transaction can have up to 10.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('transactionId', transactionId);
      await api.post('/attachments', form);
      invalidate();
      toast.success('Attachment added');
    } catch (err) {
      toast.error('Could not upload that file', err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      await api.delete(`/attachments/${id}`);
      invalidate();
      toast.success('Attachment removed');
    } catch (err) {
      toast.error('Could not remove that', errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function open(attachment: AttachmentDto) {
    try {
      await downloadFile(attachment.url);
    } catch (err) {
      toast.error('Could not open that file', errorMessage(err));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="label-eyebrow">Attachments</p>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-[12px] font-medium text-gold underline-offset-4 transition-colors hover:underline disabled:opacity-50"
        >
          <Upload aria-hidden className="size-3.5" />
          {uploading ? 'Uploading…' : 'Add receipt'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
      </div>

      {attachments.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-line-strong px-3.5 py-3 text-[12px] text-ink-faint">
          <Paperclip aria-hidden className="size-3.5" />
          No receipts attached yet.
        </p>
      ) : (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {attachments.map((attachment) => (
            <AttachmentThumb
              key={attachment.id}
              attachment={attachment}
              onOpen={() => void open(attachment)}
              onRemove={() => void remove(attachment.id)}
              removing={deletingId === attachment.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachmentThumb({
  attachment,
  onOpen,
  onRemove,
  removing,
}: {
  attachment: AttachmentDto;
  onOpen: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const { url, loading } = useAuthedBlobUrl(attachment.thumbnailUrl ?? null);

  return (
    <li className="group relative aspect-square overflow-hidden rounded-md border border-line bg-sunken">
      <button type="button" onClick={onOpen} className="block size-full" title={attachment.fileName}>
        {loading ? (
          <span className="skeleton block size-full" />
        ) : url ? (
          <img src={url} alt={attachment.fileName} className="size-full object-cover" />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1 text-ink-muted">
            <FileText aria-hidden className="size-5" />
            <span className="px-1 text-center text-[9px] leading-tight">{attachment.fileName}</span>
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Remove ${attachment.fileName}`}
        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-ink/70 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-60"
      >
        <Trash2 aria-hidden className="size-3" />
      </button>
    </li>
  );
}
