import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  AlertTriangle,
  Clock,
  Download,
} from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/api';
import type { Subscription, Invoice, UsageSummary } from '@/lib/types';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatCents, formatDate, daysUntil } from '@/lib/utils';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`}
      aria-hidden="true"
    />
  );
}

function CardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-40" />
      </CardContent>
    </Card>
  );
}

// ─── Plan status card ─────────────────────────────────────────────────────────

function PlanStatusCard({ sub }: { sub: Subscription }) {
  const trialDaysLeft = sub.trial_end ? daysUntil(sub.trial_end) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-gray-900 dark:text-white">
            {sub.plan.display_name}
          </span>
          <StatusBadge status={sub.status} />
        </div>

        {sub.plan.price_monthly !== null ? (
          <p className="text-sm text-gray-500">
            {formatCents(sub.plan.price_monthly * 100)} / month
          </p>
        ) : (
          <p className="text-sm text-gray-500">Custom pricing</p>
        )}

        {/* Trial countdown */}
        {sub.status === 'trialing' && trialDaysLeft !== null && (
          <div className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
            <Clock className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            {trialDaysLeft > 0
              ? `${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left in trial`
              : 'Trial ends today'}
          </div>
        )}

        {/* Cancel at period end warning */}
        {sub.cancel_at_period_end && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            Cancels {formatDate(sub.current_period_end)}
          </div>
        )}

        <p className="text-sm text-gray-500">
          Next invoice:{' '}
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {formatDate(sub.current_period_end)}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Usage summary card ───────────────────────────────────────────────────────

function UsageSummaryCard({ summary }: { summary: UsageSummary }) {
  const pct =
    summary.limit !== null && summary.limit > 0
      ? Math.min(100, Math.round((summary.total_usage / summary.limit) * 100))
      : null;

  const metricLabel = summary.metric.replace(/_/g, ' ');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage This Period</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-medium capitalize text-gray-700 dark:text-gray-300">
              {metricLabel}
            </span>
            <span className="text-sm text-gray-500">
              {summary.total_usage.toLocaleString()}
              {summary.limit !== null
                ? ` / ${summary.limit.toLocaleString()}`
                : ''}
            </span>
          </div>

          {pct !== null && (
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${metricLabel} usage: ${pct}%`}
              className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  pct >= 90
                    ? 'bg-red-500'
                    : pct >= 70
                      ? 'bg-amber-500'
                      : 'bg-green-500'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {pct !== null && pct >= 80 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {pct >= 90 ? 'Almost at limit — consider upgrading.' : `${pct}% used.`}
            </p>
          )}
        </div>

        <p className="text-xs text-gray-400">
          Period: {format(new Date(summary.period_start), 'MMM d')} –{' '}
          {format(new Date(summary.period_end), 'MMM d, yyyy')}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Recent invoices mini-table ───────────────────────────────────────────────

function RecentInvoices({ invoices }: { invoices: Invoice[] }) {
  if (invoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400">No invoices yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Invoices</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                PDF
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                className="border-b border-gray-50 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
              >
                <td className="px-6 py-3 text-gray-700 dark:text-gray-200">
                  {formatDate(inv.created_at)}
                </td>
                <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">
                  {formatCents(inv.amount_due, inv.currency)}
                </td>
                <td className="px-6 py-3">
                  <StatusBadge status={inv.status} />
                </td>
                <td className="px-6 py-3 text-right">
                  {inv.pdf_url ? (
                    <a
                      href={inv.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Download PDF for invoice ${inv.number}`}
                      className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      {message}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();

  const subsQuery = useQuery({
    queryKey: ['subscriptions', 'active'],
    queryFn: async () => {
      const { data } = await api.get<{ data: Subscription[] }>(
        '/subscriptions?status=active&limit=1',
      );
      return data.data[0] ?? null;
    },
  });

  const invoicesQuery = useQuery({
    queryKey: ['invoices', 'recent'],
    queryFn: async () => {
      const { data } = await api.get<{ data: Invoice[] }>('/invoices?limit=5');
      return data.data;
    },
  });

  const usageQuery = useQuery({
    queryKey: ['usage', 'summary'],
    queryFn: async () => {
      const { data } = await api.get<UsageSummary>('/usage/summary');
      return data;
    },
    // Usage summary may not exist for all plans; treat 404 as null
    retry: (failCount, error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) return false;
      return failCount < 1;
    },
  });

  const isLoading =
    subsQuery.isLoading || invoicesQuery.isLoading || usageQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard
        </h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/invoices')}
            aria-label="View all invoices"
          >
            View All Invoices
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/plans')}
            aria-label="Upgrade your plan"
          >
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            Upgrade Plan
          </Button>
        </div>
      </div>

      {/* Top cards row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Plan status */}
        {subsQuery.isLoading ? (
          <CardSkeleton />
        ) : subsQuery.isError ? (
          <ErrorState message="Could not load subscription data." />
        ) : subsQuery.data ? (
          <PlanStatusCard sub={subsQuery.data} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Current Plan</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">No active subscription.</p>
              <Button
                variant="primary"
                size="sm"
                className="mt-3"
                onClick={() => navigate('/plans')}
                aria-label="Choose a plan"
              >
                Choose a Plan
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Usage summary */}
        {usageQuery.isLoading ? (
          <CardSkeleton />
        ) : usageQuery.isError || !usageQuery.data ? (
          <Card>
            <CardHeader>
              <CardTitle>Usage This Period</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-400">No usage data available.</p>
            </CardContent>
          </Card>
        ) : (
          <UsageSummaryCard summary={usageQuery.data} />
        )}
      </div>

      {/* Recent invoices */}
      {isLoading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : invoicesQuery.isError ? (
        <ErrorState message="Could not load invoice history." />
      ) : (
        <RecentInvoices invoices={invoicesQuery.data ?? []} />
      )}

      {/* Active plan quick badges */}
      {subsQuery.data && (
        <div className="flex flex-wrap gap-2">
          {subsQuery.data.plan.features.slice(0, 4).map((f) => (
            <Badge key={f} variant="default" className="text-xs">
              {f}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
