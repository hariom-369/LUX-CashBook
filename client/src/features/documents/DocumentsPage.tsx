import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, FolderOpen, RotateCcw, Trash2, Upload } from 'lucide-react';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, diffInDays, formatDate, type AttachmentDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input, Select } from '../../components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useAuthedBlobUrl } from '../../hooks/useAuthedBlobUrl';
import { useAuthStore } from '../../stores/auth.store';
import { useDocuments, type DocumentFilters } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { DocumentUploadSheet } from './DocumentUploadSheet';
import { useT } from '../../i18n';

/**
 * Receipt gallery & document vault (docs/FEATURE_ROADMAP.md Phase 6).
 *
 * Shows every `Attachment` in the workspace, not just ones linked to a
 * transaction — a warranty or rent agreement never needs one. "Restore"
 * works because `deleteAttachment` now keeps the file for 30 days (see
 * `ROADMAP_PHASE6_NOTES.md`) rather than purging it immediately.
 */
export function DocumentsPage() {
  const tr = useT();
  const ws = useAuthStore((s) => s.activeWorkspaceId ?? 'none');
  const queryClient = useQueryClient();
  const toast = useToast();

  const [docType, setDocType] = useState<DocumentFilters['docType']>(undefined);
  const [search, setSearch] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: documents = [], isLoading, isError, error, refetch } = useDocuments({
    docType,
    search: search || undefined,
    includeDeleted: showDeleted,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: [ws, 'documents'] });
  }

  async function remove(doc: AttachmentDto) {
    try {
      await api.delete(`/attachments/${doc.id}`);
      invalidate();
      toast.success(tr('documents.movedToTrash'), tr('documents.restorableFor30Days'));
    } catch (err) {
      toast.error(tr('common.couldNotDeleteThat'), errorMessage(err));
    }
  }

  async function restore(doc: AttachmentDto) {
    try {
      await api.post(`/attachments/${doc.id}/restore`);
      invalidate();
      toast.success(tr('documents.restored'));
    } catch (err) {
      toast.error(tr('common.couldNotRestoreThat'), errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{tr('nav.documents')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{tr('documents.receiptsBillsWarrantiesAndAnythingElse')}</p>
        </div>
        <Button variant="gold" leftIcon={<Upload className="size-4" />} onClick={() => setUploading(true)}>
          {tr('documents.addDocument')}
        </Button>
      </header>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder={tr('documents.searchByTitleOrFileName')} value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-[200px] flex-1" />
          <Select aria-label={tr('documents.filterByType')} className="w-auto min-w-[150px]" value={docType ?? ''} onChange={(e) => setDocType((e.target.value || undefined) as DocumentFilters['docType'])}>
            <option value="">{tr('documents.allTypes')}</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {tr.label('docType', t, DOCUMENT_TYPE_LABELS[t])}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="size-4 rounded-sm border-line text-gold focus:ring-gold" />
            {tr('documents.showDeleted')}
          </label>
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
      ) : documents.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderOpen className="size-5" />}
            title={tr('documents.noDocumentsYet')}
            description={tr('documents.receiptsAttachedInQuickAddShow')}
            action={
              <Button variant="gold" size="sm" leftIcon={<Upload className="size-4" />} onClick={() => setUploading(true)}>
                {tr('documents.addADocument')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {documents.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} onDelete={() => void remove(doc)} onRestore={() => void restore(doc)} />
          ))}
        </div>
      )}

      <DocumentUploadSheet open={uploading} onClose={() => setUploading(false)} onUploaded={invalidate} />
    </div>
  );
}

function DocumentCard({ doc, onDelete, onRestore }: { doc: AttachmentDto; onDelete: () => void; onRestore: () => void }) {
  const tr = useT();
  const toast = useToast();
  const { url, loading } = useAuthedBlobUrl(doc.thumbnailUrl ?? null);
  const daysToExpiry = doc.expiryDate ? diffInDays(new Date(doc.expiryDate), new Date()) : undefined;

  async function open() {
    try {
      await downloadFile(doc.url);
    } catch (err) {
      toast.error(tr('common.couldNotOpenThatFile'), errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
      <button type="button" onClick={() => void open()} className="aspect-square bg-sunken" title={doc.fileName}>
        {loading ? (
          <span className="skeleton block size-full" />
        ) : url ? (
          <img src={url} alt={doc.title ?? doc.fileName} className="size-full object-cover" />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1.5 text-ink-muted">
            <FileText aria-hidden className="size-6" />
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <span className="truncate text-[12.5px] font-medium text-ink">{doc.title || doc.fileName}</span>
        <div className="flex flex-wrap items-center gap-1">
          {doc.docType && (
            <Badge tone="outline" eyebrow>
              {tr.label('docType', doc.docType, DOCUMENT_TYPE_LABELS[doc.docType])}
            </Badge>
          )}
          {doc.deletedAt && (
            <Badge tone="negative" eyebrow>
              {tr('common.deleted')}
            </Badge>
          )}
          {!doc.deletedAt && daysToExpiry !== undefined && daysToExpiry <= 30 && (
            <Badge tone={daysToExpiry < 0 ? 'negative' : 'warning'} eyebrow>
              {daysToExpiry < 0 ? tr('documents.expired') : tr('documents.expiresInDays', { days: daysToExpiry })}
            </Badge>
          )}
        </div>
        {doc.expiryDate && <span className="text-[11px] text-ink-muted">{tr('documents.expires')} {formatDate(doc.expiryDate)}</span>}
        <div className="mt-auto flex justify-end">
          {doc.deletedAt ? (
            <button type="button" onClick={onRestore} aria-label={tr('common.restore')} title={tr('common.restore')} className="rounded-sm p-1.5 text-ink-muted transition-colors hover:bg-sunken hover:text-ink">
              <RotateCcw aria-hidden className="size-3.5" />
            </button>
          ) : (
            <button type="button" onClick={onDelete} aria-label={tr('common.delete')} title={tr('common.delete')} className="rounded-sm p-1.5 text-ink-muted transition-colors hover:bg-sunken hover:text-negative">
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
