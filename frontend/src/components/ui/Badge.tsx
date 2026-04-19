import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import type { SubscriptionStatus, InvoiceStatus } from '@/lib/types';

type BadgeVariant =
  | SubscriptionStatus
  | InvoiceStatus
  | 'default'
  | 'success'
  | 'warning'
  | 'danger';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

// Maps semantic status names to Tailwind color classes
const variantClasses: Record<string, string> = {
  // Subscription statuses
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  trialing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  canceled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  past_due: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  incomplete: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  paused: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  // Invoice statuses
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  open: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  void: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  uncollectible: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  // Generic
  default: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  const colorClasses = variantClasses[variant] ?? variantClasses.default;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        colorClasses,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

// Convenience: capitalizes first letter of a status for display
function StatusBadge({
  status,
  ...props
}: { status: BadgeVariant } & Omit<BadgeProps, 'variant'>) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge variant={status} {...props}>
      {label}
    </Badge>
  );
}

export { Badge, StatusBadge };
export type { BadgeProps, BadgeVariant };
