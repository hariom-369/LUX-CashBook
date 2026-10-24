import { useState } from 'react';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useInvalidateGroup } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

/**
 * Asks before deleting a group. Deleting removes the group from Groups (the server archives
 * it, like every other delete in this app), but never touches what's already in your own
 * books — your shares, and money lent, borrowed or repaid were real and stay in your accounts
 * and People ledger. The warning is stronger when the group still has money to settle.
 */
export function DeleteGroupDialog({
  group,
  unsettled = false,
  onClose,
  onDeleted,
}: {
  /** The group to delete; `null` keeps the dialog closed. */
  group: { id: string; name: string } | null;
  unsettled?: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateGroup(group?.id);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!group) return;
    setBusy(true);
    try {
      await api.delete(`/groups/${group.id}`);
      invalidate();
      toast.success(t('groups.groupDeleted'));
      onClose();
      onDeleted?.();
    } catch (err) {
      toast.error(t('common.couldNotRemoveThat'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={Boolean(group)}
      onCancel={onClose}
      onConfirm={confirm}
      title={t('groups.deleteGroupName', { name: group?.name ?? '' })}
      description={unsettled ? t('groups.groupNotSettledDeleteWarning') : t('groups.deletingAGroupKeepsYourRecords')}
      confirmLabel={t('groups.deleteGroup')}
      tone="danger"
      busy={busy}
    />
  );
}
