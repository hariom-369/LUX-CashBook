import { useCallback } from 'react';
import type { NavItem } from '../config/navigation';
import { useT } from './index';
import type { MessageKey } from './messages/en';

/** Translated nav labels (§Phase 14); falls back to the item's own English label. */
export function useNavLabels() {
  const t = useT();
  const item = useCallback(
    (i: NavItem) => {
      const key = `nav.${i.to === '/' ? 'dashboard' : i.to.slice(1)}` as MessageKey;
      const text = t(key);
      return text ?? i.label;
    },
    [t],
  );
  const group = useCallback(
    (id: string, fallback: string | null) => (fallback ? (t(`nav.group.${id}` as MessageKey) ?? fallback) : null),
    [t],
  );
  return { item, group };
}
