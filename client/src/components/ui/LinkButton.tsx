import { Link, type LinkProps } from 'react-router-dom';
import type { ReactNode } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './Button';
import { cn } from '../../lib/cn';

/**
 * A router link that looks like a button.
 *
 * Navigation belongs in an `<a>`, not a `<button>` with an onClick: middle-click,
 * open-in-new-tab and "copy link address" all stop working the moment you fake it
 * (§59). This keeps the semantics right without a second set of styles.
 */
export interface LinkButtonProps extends Omit<LinkProps, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  fullWidth,
  leftIcon,
  rightIcon,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link className={cn(buttonClasses(variant, size, fullWidth), className)} {...props}>
      {leftIcon}
      {children}
      {rightIcon}
    </Link>
  );
}
