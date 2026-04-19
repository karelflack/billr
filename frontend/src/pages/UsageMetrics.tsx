import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Download, AlertTriangle } from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import api from '@/lib/api';
import type { UsageSummary, UsageMetricName } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { downloadCsv } from '@/lib/utils';
import { cn } from '@/lib/utils';

// ─── Metric selector ──────────────────────────────────────────────────────────

const METRICS: Array<{ value: UsageMetricName; label: string }> = [
  { value: 'api_calls', label: 'API Calls' },
  { value: 'seats', label: 'Seats' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'webhook_deliveries', label: 'Webhook Deliveries' },
];

interface MetricSelectorProps {
  value: UsageMetricName;
  onChange: (v: UsageMetricName) => void;
}

function MetricSelector({ value, onChange }: MetricSelectorProps) {
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => onChange(v as UsageMetricName)}
    >
      <Select.Trigger
        className={cn(
          'inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
          'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500',
          'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
        )}
        aria-label="Select usage metric"
      >
        <Select.Value />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className={cn(
            'z-50 min-w-[200px] overflow-hidden rounded-md border border-gray-200 bg-white shadow-md',
            'dark:border-gray-700 dark:bg-gray-900',
          )}
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport className="p-1">
            {METRICS.map((m) => (
              <Select.Item
                key={m.value}
                value={m.value}
                className={cn(
                  'cursor-pointer rounded px-3 py-1.5 text-sm text-gray-700 outline-none',
                  'hover:bg-indigo-50 hover:text-indigo-700',
                  'data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700',
                  'dark:text-gray-200 dark:hover:bg-gray-800 dark:data-[highlighted]:bg-gray-800',
                )}
              >
                <Select.ItemText>{m.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`}
      aria-hidden="true"
    />
  );
}

// ─── Custom tooltip for Recharts ──────────────────────────────────────────────

interface TooltipPayload {
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-md dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
        {payload[0].value.toLocaleString()}
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UsageMetrics() {
  const [metric, setMetric] = useState<UsageMetricName>('api_calls');

  // Default date range: current billing month
  const [startDate, setStartDate] = useState(
    format(startOfMonth(new Date()), 'yyyy-MM-dd'),
  );
  const [endDate, setEndDate] = useState(
    format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  );

  const usageQuery = useQuery({
    queryKey: ['usage', metric, startDate, endDate],
    queryFn: async () => {
      const { data } = await api.get<UsageSummary>(
        `/usage/summary?metric=${metric}&start_date=${startDate}&end_date=${endDate}`,
      );
      return data;
    },
    retry: (failCount, error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) return false;
      return failCount < 1;
    },
  });

  const summary = usageQuery.data;
  const chartData =
    summary?.usage_by_day.map((d) => ({
      date: format(new Date(d.date), 'MMM d'),
      value: d.quantity,
    })) ?? [];

  const metricLabel =
    METRICS.find((m) => m.value === metric)?.label ?? metric;

  const pct =
    summary?.limit && summary.limit > 0
      ? Math.min(100, Math.round((summary.total_usage / summary.limit) * 100))
      : null;

  function handleExportCsv() {
    if (!summary) return;
    const rows = summary.usage_by_day.map((d) => ({
      date: d.date,
      metric: summary.metric,
      quantity: d.quantity,
    }));
    downloadCsv(rows, `billr-usage-${metric}-${startDate}-${endDate}.csv`);
  }

  const inputClass = cn(
    'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
    'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500',
    'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200',
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Usage Metrics
        </h1>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExportCsv}
          disabled={!summary || summary.usage_by_day.length === 0}
          aria-label="Export usage data as CSV"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <MetricSelector value={metric} onChange={setMetric} />

        <div className="flex items-center gap-2">
          <label htmlFor="usage-start" className="sr-only">
            Start date
          </label>
          <input
            id="usage-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass}
            aria-label="Usage start date"
          />
          <span className="text-sm text-gray-400">to</span>
          <label htmlFor="usage-end" className="sr-only">
            End date
          </label>
          <input
            id="usage-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
            aria-label="Usage end date"
          />
        </div>
      </div>

      {/* Usage totals card */}
      {usageQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : usageQuery.isError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          <AlertTriangle className="h-4 w-4" />
          Could not load usage data.
        </div>
      ) : summary ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {metricLabel} — Current Period Total
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-gray-900 dark:text-white">
                {summary.total_usage.toLocaleString()}
              </span>
              {summary.limit && (
                <span className="text-lg text-gray-400">
                  / {summary.limit.toLocaleString()}
                </span>
              )}
            </div>

            {pct !== null && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{pct}% used</span>
                  {summary.limit && (
                    <span>
                      {(summary.limit - summary.total_usage).toLocaleString()} remaining
                    </span>
                  )}
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${metricLabel} usage: ${pct}%`}
                  className="h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      pct >= 90
                        ? 'bg-red-500'
                        : pct >= 70
                          ? 'bg-amber-500'
                          : 'bg-indigo-600'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {pct >= 80 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {pct >= 90
                      ? 'You are approaching your plan limit. Upgrade to avoid overage charges.'
                      : `${pct}% of plan limit used.`}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-gray-400">
            No usage data for the selected period.
          </CardContent>
        </Card>
      )}

      {/* Bar chart */}
      <Card>
        <CardHeader>
          <CardTitle>{metricLabel} — Daily Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {usageQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : chartData.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-gray-400">
              No daily data available for this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={chartData}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                aria-label={`${metricLabel} daily usage bar chart`}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e5e7eb"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
                  }
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey="value"
                  fill="#4f46e5"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
