import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A sideways-scrolling wrapper for a wide table (§Phase 16).
 *
 * Content that scrolls must be reachable without a mouse: a keyboard user cannot
 * scroll a plain `overflow-x-auto` box that has nothing focusable inside it. This
 * makes the box itself a labelled, focusable region, so Tab lands on it and the
 * arrow keys scroll it (WCAG 2.1.1).
 */
export function ScrollRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div
      role="region"
      // A scrollable region must be focusable to be operable from the keyboard (WCAG 2.1.1, axe `scrollable-region-focusable`).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={label}
      className={cn(
        'overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold',
        className,
      )}
    >
      {children}
    </div>
  );
}
