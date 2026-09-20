import { useMemo } from 'react';
import { cn } from '../../lib/cn';

/**
 * Password strength feedback.
 *
 * Computed locally rather than by calling the API: sending a password over the
 * wire on every keystroke to be told it is weak is both slow and a needless
 * exposure. The scoring mirrors the server's `passwordStrength()` so the two never
 * disagree in front of the user.
 *
 * This is guidance, not a gate — length is the only rule the server enforces.
 */
function score(password: string): number {
  if (!password) return -1;
  let value = 0;
  if (password.length >= 10) value++;
  if (password.length >= 14) value++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) value++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) value++;
  if (/^(.)\1+$/.test(password) || /^(012|123|abc|qwerty|password)/i.test(password)) value = 0;
  return Math.min(value, 4);
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
const COLORS = ['bg-negative', 'bg-negative', 'bg-warning', 'bg-positive', 'bg-positive'];

export function PasswordStrength({ password }: { password: string }) {
  const value = useMemo(() => score(password), [password]);

  if (value < 0) return null;

  return (
    <div className="-mt-1.5">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              index < Math.max(value, 1) ? COLORS[value] : 'bg-line',
            )}
          />
        ))}
      </div>
      <p aria-live="polite" className="mt-1.5 text-[12px] text-ink-muted">
        Strength: <span className="font-medium text-ink-secondary">{LABELS[value]}</span>
      </p>
    </div>
  );
}
