import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose class names, letting later Tailwind utilities win over earlier ones.
 *
 * Without `twMerge`, a component that ships `px-4` and a caller that passes `px-6`
 * produce `px-4 px-6` and the winner depends on stylesheet order. With it, the
 * caller's intent always wins — which is what makes every component's `className`
 * prop genuinely useful instead of a trap.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
