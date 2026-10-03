import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;

/** Matches the server's normalisation (`models/shared.ts#tagsField`) exactly. */
function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#/, '').slice(0, MAX_TAG_LENGTH);
}

/**
 * A small chip editor for a transaction's tags. Enter, comma or Tab commits the
 * current text as a tag; Backspace on an empty field removes the last one.
 * Values are normalised the same way the server does (lowercase, `#` stripped,
 * deduplicated, capped at 20) so what's shown here is exactly what gets saved.
 */
export function TagsInput({
  value,
  onChange,
  id,
  placeholder = 'Add a tag…',
  disabled,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const tr = useT();
  const [draft, setDraft] = useState('');

  function commit(text: string) {
    const tag = normalize(text);
    if (!tag || value.includes(tag) || value.length >= MAX_TAGS) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      if (draft.trim()) {
        event.preventDefault();
        commit(draft);
      }
      return;
    }
    if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 py-1.5',
        'transition-[border-color,background-color,box-shadow] duration-150 ease-[--ease-out-soft]',
        'focus-within:border-gold focus-within:bg-surface focus-within:ring-4 focus-within:ring-[--k-gold-ring]',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-sm bg-surface px-2 py-1 text-[12px] font-medium text-ink-secondary"
        >
          #{tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              aria-label={tr('ui.removeTag', { tag })}
              className="text-ink-faint transition-colors hover:text-negative"
            >
              <X aria-hidden className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled || value.length >= MAX_TAGS}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        className="min-w-[6rem] flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
      />
    </div>
  );
}
