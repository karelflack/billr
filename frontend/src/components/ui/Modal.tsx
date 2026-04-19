import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

// Re-export Radix primitives for granular usage
export const ModalRoot = Dialog.Root;
export const ModalTrigger = Dialog.Trigger;
export const ModalClose = Dialog.Close;

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Width class override, defaults to max-w-lg */
  maxWidth?: string;
}

/**
 * Accessible modal dialog built on Radix Dialog.
 * Focus is trapped inside while open (Radix handles this automatically).
 * Closes on Escape key or overlay click.
 */
function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  maxWidth = 'max-w-lg',
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        {/* Panel */}
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2',
            'rounded-lg bg-white p-6 shadow-xl',
            'dark:bg-gray-900',
            'data-[state=open]:animate-fade-in',
            'focus:outline-none',
            maxWidth,
            className,
          )}
          // Prevents closing if user accidentally clicks inside content
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-gray-900 dark:text-white">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:hover:bg-gray-800"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div
      className={cn(
        'mt-6 flex items-center justify-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800',
        className,
      )}
    >
      {children}
    </div>
  );
}

export { Modal, ModalFooter };
