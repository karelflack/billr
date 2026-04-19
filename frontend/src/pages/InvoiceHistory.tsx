import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, AlertTriangle, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import api from '@/lib/api';
import type { Invoice, InvoiceStatus, PaginatedInvoices } from '@/lib/types';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  SortableHead,
  useSortable,
} from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { formatCents, formatDate, cn } from '@/lib/utils';

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <TableRow>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </TableCell>
      ))}
    </TableRow>
  );
}

// ─── Status filter dropdown ───────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'paid', label: 'Paid' },
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'void', label: 'Void' },
  { value: 'uncollectible', label: 'Uncollectible' },
];

interface StatusFilterProps {
  value: string;
  onChange: (v: string) => void;
}

function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        className={cn(
          'inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
          'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500',
          'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
        )}
        aria-label="Filter by invoice status"
      >
        <Filter className="h-4 w-4 text-gray-400" aria-hidden="true" />
        <Select.Value />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className={cn(
            'z-50 min-w-[160px] overflow-hidden rounded-md border border-gray-200 bg-white shadow-md',
            'dark:border-gray-700 dark:bg-gray-900',
          )}
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport className="p-1">
            {STATUS_OPTIONS.map((opt) => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className={cn(
                  'cursor-pointer rounded px-3 py-1.5 text-sm text-gray-700 outline-none',
                  'hover:bg-indigo-50 hover:text-indigo-700',
                  'data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700',
                  'dark:text-gray-200 dark:hover:bg-gray-800 dark:data-[highlighted]:bg-gray-800',
                )}
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

// ─── Date range inputs ────────────────────────────────────────────────────────

interface DateRangeProps {
  startDate: string;
  endDate: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}

function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}: DateRangeProps) {
  const inputClass = cn(
    'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
    'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500',
    'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200',
  );
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="date-start" className="sr-only">
        Start date
      </label>
      <input
        id="date-start"
        type="date"
        value={startDate}
        onChange={(e) => onStartChange(e.target.value)}
        className={inputClass}
        aria-label="Filter from date"
      />
      <span className="text-sm text-gray-400">to</span>
      <label htmlFor="date-end" className="sr-only">
        End date
      </label>
      <input
        id="date-end"
        type="date"
        value={endDate}
        onChange={(e) => onEndChange(e.target.value)}
        className={inputClass}
        aria-label="Filter to date"
      />
    </div>
  );
}

// ─── PDF download handler ─────────────────────────────────────────────────────

async function downloadInvoicePdf(invoiceId: string): Promise<void> {
  // GET /invoices/:id/pdf returns a signed URL; open in new tab
  const { data } = await api.get<{ url: string }>(`/invoices/${invoiceId}/pdf`);
  window.open(data.url, '_blank', 'noopener,noreferrer');
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InvoiceHistory() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Build query string from filters
  const buildParams = useCallback(() => {
    const params: Record<string, string> = { limit: '20' };
    if (statusFilter !== 'all') params.status = statusFilter;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (cursor) params.cursor = cursor;
    return new URLSearchParams(params).toString();
  }, [statusFilter, startDate, endDate, cursor]);

  const query = useQuery({
    queryKey: ['invoices', statusFilter, startDate, endDate, cursor],
    queryFn: async () => {
      const { data } = await api.get<PaginatedInvoices>(
        `/invoices?${buildParams()}`,
      );
      return data;
    },
  });

  const { sortKey, direction, handleSort, sortedData } = useSortable<Invoice>(
    query.data?.data ?? [],
    (row, key) => {
      switch (key) {
        case 'date': return row.created_at;
        case 'number': return row.number;
        case 'amount': return row.amount_due;
        case 'status': return row.status;
        default: return null;
      }
    },
  );

  function handleStatusChange(v: string) {
    setStatusFilter(v);
    setCursor(null); // Reset pagination on filter change
  }

  async function handleDownloadPdf(invoice: Invoice) {
    if (!invoice.pdf_url && !invoice.id) return;
    setDownloadingId(invoice.id);
    try {
      if (invoice.pdf_url) {
        window.open(invoice.pdf_url, '_blank', 'noopener,noreferrer');
      } else {
        await downloadInvoicePdf(invoice.id);
      }
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
        Invoice History
      </h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <StatusFilter value={statusFilter} onChange={handleStatusChange} />
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartChange={(v) => { setStartDate(v); setCursor(null); }}
          onEndChange={(v) => { setEndDate(v); setCursor(null); }}
        />
        {(statusFilter !== 'all' || startDate || endDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter('all');
              setStartDate('');
              setEndDate('');
              setCursor(null);
            }}
            aria-label="Clear all filters"
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table card */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {query.isError ? (
            <div
              role="alert"
              className="flex items-center gap-2 px-6 py-4 text-sm text-red-700 dark:text-red-400"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Failed to load invoices. Please try again.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    sortKey="date"
                    currentSortKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  >
                    Date
                  </SortableHead>
                  <SortableHead
                    sortKey="number"
                    currentSortKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  >
                    Invoice #
                  </SortableHead>
                  <TableHead>Period</TableHead>
                  <SortableHead
                    sortKey="status"
                    currentSortKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                  >
                    Status
                  </SortableHead>
                  <SortableHead
                    sortKey="amount"
                    currentSortKey={sortKey}
                    direction={direction}
                    onSort={handleSort}
                    className="text-right"
                  >
                    Amount
                  </SortableHead>
                  <TableHead className="text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {query.isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <SkeletonRow key={i} />
                    ))
                  : sortedData.length === 0
                    ? (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="py-12 text-center text-sm text-gray-400"
                          >
                            No invoices yet.
                          </TableCell>
                        </TableRow>
                      )
                    : sortedData.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell>{formatDate(invoice.created_at)}</TableCell>
                          <TableCell className="font-mono text-xs text-gray-500">
                            {invoice.number}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {formatDate(invoice.period_start)} –{' '}
                            {formatDate(invoice.period_end)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={invoice.status as InvoiceStatus} />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCents(invoice.amount_due, invoice.currency)}
                          </TableCell>
                          <TableCell className="text-right">
                            <button
                              onClick={() => handleDownloadPdf(invoice)}
                              disabled={downloadingId === invoice.id}
                              className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 disabled:opacity-50 dark:text-indigo-400"
                              aria-label={`Download PDF for invoice ${invoice.number}`}
                            >
                              {downloadingId === invoice.id ? (
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                              ) : (
                                <Download className="h-4 w-4" aria-hidden="true" />
                              )}
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {/* Pagination */}
        {!query.isLoading && !query.isError && query.data && (
          <div className="flex items-center justify-between border-t border-gray-100 px-6 py-3 dark:border-gray-800">
            <p className="text-sm text-gray-400">
              Showing {sortedData.length} invoice
              {sortedData.length !== 1 ? 's' : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!cursor}
                onClick={() => setCursor(null)}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Prev
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!query.data.has_more}
                onClick={() =>
                  setCursor(query.data.next_cursor ?? null)
                }
                aria-label="Next page"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
