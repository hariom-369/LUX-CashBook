import { useEffect, useRef, useState } from 'react';
import { Copy, Share2 } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button, type ButtonProps } from './ui/Button';
import { useToast } from './ui/Toast';
import { canUseNativeShare, copyToClipboard, shareNatively, whatsAppShareUrl, type ShareContent } from '../lib/share';

/**
 * Share (§36, §48).
 *
 * On a phone with OS share support, the button skips straight to the native
 * share sheet — one tap, no menu. Everywhere else it opens a small menu with
 * WhatsApp and copy, since those cover the two ways people actually forward a
 * summary to someone else. Never shares anything the caller didn't explicitly
 * build into `content` — this component has no access to raw ledger data.
 */
export function ShareButton({
  content,
  label = 'Share',
  size = 'sm',
  variant = 'secondary',
}: {
  content: ShareContent;
  label?: string;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  async function handlePrimaryClick() {
    if (canUseNativeShare()) {
      const result = await shareNatively(content);
      if (result === 'unavailable') {
        const copied = await copyToClipboard(content);
        if (copied === 'copied') toast.success('Copied to clipboard', 'Sharing was unavailable, so we copied it instead.');
      }
      return;
    }
    setOpen((o) => !o);
  }

  async function handleCopy() {
    const result = await copyToClipboard(content);
    setOpen(false);
    if (result === 'copied') toast.success('Copied to clipboard');
    else toast.error("Couldn't copy", 'Your browser blocked clipboard access.');
  }

  function handleWhatsApp() {
    window.open(whatsAppShareUrl(content), '_blank', 'noopener,noreferrer');
    setOpen(false);
  }

  return (
    <div ref={menuRef} className="relative inline-block">
      <Button type="button" size={size} variant={variant} leftIcon={<Share2 className="size-3.5" />} onClick={() => void handlePrimaryClick()}>
        {label}
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Share options"
          className={cn(
            'absolute right-0 z-40 mt-1.5 w-48 overflow-hidden rounded-md border border-line bg-raised py-1 shadow-lg',
            'animate-rise-in',
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleWhatsApp}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-ink transition-colors hover:bg-sunken"
          >
            <Icon />
            Share via WhatsApp
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleCopy()}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-ink transition-colors hover:bg-sunken"
          >
            <Copy aria-hidden className="size-4 text-ink-muted" />
            Copy summary
          </button>
        </div>
      )}
    </div>
  );
}

/** A minimal inline WhatsApp glyph — avoids pulling in a brand-icon dependency for one icon. */
function Icon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0 text-positive" fill="currentColor">
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.28-1.38a9.9 9.9 0 0 0 4.76 1.21h.01c5.46 0 9.9-4.44 9.9-9.9S17.5 2 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.13.82.84-3.05-.2-.31a8.2 8.2 0 1 1 6.97 3.86Zm4.5-6.14c-.25-.12-1.46-.72-1.68-.8-.23-.08-.39-.12-.56.12-.16.25-.64.8-.78.96-.14.16-.29.18-.53.06-.25-.12-1.04-.38-1.98-1.22-.73-.65-1.23-1.45-1.37-1.7-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.36-.77-1.86-.2-.48-.41-.42-.56-.42-.14 0-.31-.02-.47-.02-.16 0-.43.06-.66.31-.22.25-.87.85-.87 2.08 0 1.22.89 2.41 1.02 2.58.12.16 1.75 2.67 4.24 3.74.59.26 1.06.41 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.46-.6 1.67-1.17.2-.58.2-1.07.14-1.17-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}
