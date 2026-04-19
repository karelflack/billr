import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  useState,
} from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Primitives ───────────────────────────────────────────────────────────────

const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="w-full overflow-auto">
      <table
        ref={ref}
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn('[&_tr]:border-b [&_tr]:border-gray-200 dark:[&_tr]:border-gray-700', className)}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

const TableRow = forwardRef<
  HTMLTableRowElement,
  HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-gray-100 transition-colors',
      'hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50',
      'data-[state=selected]:bg-indigo-50 dark:data-[state=selected]:bg-indigo-900/20',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

const TableHead = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-12 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide',
      'text-gray-500 dark:text-gray-400',
      '[&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'px-4 py-3 align-middle text-gray-700 dark:text-gray-200',
      '[&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

// ─── Sortable column header ───────────────────────────────────────────────────

type SortDirection = 'asc' | 'desc' | null;

interface SortableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  sortKey: string;
  currentSortKey: string | null;
  direction: SortDirection;
  onSort: (key: string) => void;
}

function SortableHead({
  sortKey,
  currentSortKey,
  direction,
  onSort,
  children,
  className,
  ...props
}: SortableHeadProps) {
  const isActive = currentSortKey === sortKey;

  const Icon = isActive
    ? direction === 'asc'
      ? ChevronUp
      : ChevronDown
    : ChevronsUpDown;

  return (
    <TableHead
      className={cn('cursor-pointer select-none', className)}
      onClick={() => onSort(sortKey)}
      aria-sort={
        isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      {...props}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            isActive ? 'text-indigo-600' : 'text-gray-400',
          )}
          aria-hidden="true"
        />
      </span>
    </TableHead>
  );
}

// ─── useSortable hook ─────────────────────────────────────────────────────────

interface UseSortableReturn<T> {
  sortKey: string | null;
  direction: SortDirection;
  handleSort: (key: string) => void;
  sortedData: T[];
}

/**
 * Manages sort state and returns sorted data.
 * Pass a `getValue` function to extract the comparable value from each row.
 */
function useSortable<T>(
  data: T[],
  getValue: (row: T, key: string) => string | number | null,
): UseSortableReturn<T> {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<SortDirection>(null);

  function handleSort(key: string) {
    if (sortKey === key) {
      // Cycle: asc → desc → none
      if (direction === 'asc') setDirection('desc');
      else if (direction === 'desc') {
        setSortKey(null);
        setDirection(null);
      }
    } else {
      setSortKey(key);
      setDirection('asc');
    }
  }

  const sortedData =
    sortKey && direction
      ? [...data].sort((a, b) => {
          const aVal = getValue(a, sortKey) ?? '';
          const bVal = getValue(b, sortKey) ?? '';
          const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
          return direction === 'asc' ? cmp : -cmp;
        })
      : data;

  return { sortKey, direction, handleSort, sortedData };
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  SortableHead,
  useSortable,
};
export type { SortDirection };
