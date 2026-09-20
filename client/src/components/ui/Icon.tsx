import { Circle, icons, type LucideProps } from 'lucide-react';
import { createElement } from 'react';

/**
 * Resolve a Lucide icon from its name.
 *
 * Category and account icons are stored as strings in the database, so the icon a
 * row asks for may not exist in the bundled icon set (an older record, a typo, a
 * future rename). Falling back to a neutral circle keeps a ledger row rendering
 * instead of taking the page down over an icon.
 */
export interface IconProps extends Omit<LucideProps, 'name'> {
  name: string | undefined | null;
}

export function Icon({ name, ...props }: IconProps) {
  const resolved = name && name in icons ? icons[name as keyof typeof icons] : Circle;
  return createElement(resolved, props);
}

export function hasIcon(name: string | undefined | null): boolean {
  return Boolean(name && name in icons);
}
