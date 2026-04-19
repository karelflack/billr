import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import api from '@/lib/api';
import type {
  Subscription,
  PlanTier,
  UpcomingInvoice,
  SubscriptionStatus,
} from '@/lib/types';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { formatCents, formatDate, cn } from '@/lib/utils';

// ─── Hardcoded plan definitions (mirrors nora's pricing model) ────────────────
// These are displayed statically; the API remains the source of truth for what
// the account is actually subscribed to.

const PLAN_CARDS: Array<{
  tier: string;
  display_name: string;
  price_monthly: number | null;
  features: string[];
  cta: string;
  highlight?: boolean;
}> = [
  {
    tier: 'starter',
    display_name: 'Starter',
    price_monthly: 79,
    features: [
      '100 active subscriptions',
      '5,000 API calls / month',
      '3 webhook endpoints',
      'Invoice PDF generation',
      'Email support',
      '14-day free trial',
    ],
    cta: 'Start free trial',
  },
  {
    tier: 'growth',
    display_name: 'Growth',
    price_monthly: 349,
    features: [
      '5,000 active subscriptions',
      '100,000 API calls / month',
      'Unlimited webhook endpoints',
      'Real-time cost dashboard',
      'Usage-based billing',
      'Advanced tax handling',
      'Priority support',
    ],
    cta: 'Upgrade to Growth',
    highlight: true,
  },
  {
    tier: 'enterprise',
    display_name: 'Enterprise',
    price_monthly: null,
    features: [
      'Unlimited subscriptions',
      'Unlimited API calls',
      '99.95% webhook SLA',
      'Dedicated infrastructure',
      'Custom contracts & DPA',
      'Slack/Zoom support',
      'SSO & SAML',
    ],
    cta: 'Contact sales',
  },
];

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`}
      aria-hidden="true"
    />
  );
}

// ─── Upgrade / downgrade confirmation modal ───────────────────────────────────

interface ChangePlanModalProps {
  open: boolean;
  onClose: () => void;
  targetTier: string;
  targetDisplayName: string;
  isUpgrade: boolean;
  currentPeriodEnd: string;
  subscriptionId: string;
}

function ChangePlanModal({
  open,
  onClose,
  targetTier,
  targetDisplayName,
  isUpgrade,
  currentPeriodEnd,
  subscriptionId,
}: ChangePlanModalProps) {
  const queryClient = useQueryClient();
  const [upcomingInvoice, setUpcomingInvoice] = useState<UpcomingInvoice | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);

  // Fetch proration preview when modal opens (upgrades only)
  async function loadPreview() {
    if (!isUpgrade) return;
    setPreviewLoading(true);
    try {
      const { data } = await api.get<UpcomingInvoice>(
        `/subscriptions/${subscriptionId}/upcoming-invoice?new_plan=${targetTier}`,
      );
      setUpcomingInvoice(data);
    } catch {
      // Non-fatal — show best effort UI without proration
    } finally {
      setPreviewLoading(false);
    }
  }

  const changeMutation = useMutation({
    mutationFn: () =>
      api.patch(`/subscriptions/${subscriptionId}`, {
        plan_tier: targetTier,
        // Downgrades take effect at period end
        prorate: isUpgrade,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
        else loadPreview();
      }}
      title={isUpgrade ? `Upgrade to ${targetDisplayName}` : `Switch to ${targetDisplayName}`}
      description={
        isUpgrade
          ? 'Your new plan will take effect immediately. Any proration will appear on your next invoice.'
          : `Downgrade takes effect at the end of your current billing period (${formatDate(currentPeriodEnd)}).`
      }
    >
      {/* Proration preview (upgrades only) */}
      {isUpgrade && (
        <div className="mb-4 rounded-md bg-indigo-50 px-4 py-3 dark:bg-indigo-900/20">
          {previewLoading ? (
            <div className="flex items-center gap-2 text-sm text-indigo-600">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading proration preview…
            </div>
          ) : upcomingInvoice ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-indigo-800 dark:text-indigo-200">
                Upcoming charge
              </p>
              <p className="text-indigo-700 dark:text-indigo-300">
                Prorated amount:{' '}
                <strong>
                  {formatCents(
                    upcomingInvoice.proration_amount ?? upcomingInvoice.amount_due,
                    upcomingInvoice.currency,
                  )}
                </strong>
              </p>
            </div>
          ) : (
            <p className="text-sm text-indigo-600 dark:text-indigo-400">
              Proration preview unavailable — your card will be charged the
              prorated amount.
            </p>
          )}
        </div>
      )}

      {changeMutation.isError && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Something went wrong. Please try again.
        </div>
      )}

      <ModalFooter>
        <Button variant="secondary" onClick={onClose} aria-label="Cancel plan change">
          Cancel
        </Button>
        <Button
          variant={isUpgrade ? 'primary' : 'secondary'}
          isLoading={changeMutation.isPending}
          onClick={() => changeMutation.mutate()}
          aria-label={`Confirm switch to ${targetDisplayName}`}
        >
          {isUpgrade ? 'Confirm Upgrade' : 'Confirm Downgrade'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Cancel subscription modal ────────────────────────────────────────────────

interface CancelModalProps {
  open: boolean;
  onClose: () => void;
  subscriptionId: string;
  periodEnd: string;
}

type CancelTiming = 'immediately' | 'period_end';

function CancelModal({
  open,
  onClose,
  subscriptionId,
  periodEnd,
}: CancelModalProps) {
  const queryClient = useQueryClient();
  const [timing, setTiming] = useState<CancelTiming>('period_end');

  const cancelMutation = useMutation({
    mutationFn: () =>
      api.delete(`/subscriptions/${subscriptionId}`, {
        data: { cancel_at_period_end: timing === 'period_end' },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Cancel Subscription"
      description="Are you sure? This will end your access to Billr features."
    >
      <RadioGroup.Root
        value={timing}
        onValueChange={(v) => setTiming(v as CancelTiming)}
        className="space-y-3"
        aria-label="Cancellation timing"
      >
        <div className="flex items-start gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <RadioGroup.Item
            value="period_end"
            id="cancel-period-end"
            className="mt-0.5 h-4 w-4 rounded-full border border-gray-300 data-[state=checked]:border-indigo-600 data-[state=checked]:bg-indigo-600"
          >
            <RadioGroup.Indicator className="flex h-full w-full items-center justify-center after:block after:h-2 after:w-2 after:rounded-full after:bg-white" />
          </RadioGroup.Item>
          <label htmlFor="cancel-period-end" className="cursor-pointer">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              At period end
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Keep access until {formatDate(periodEnd)}, then cancel.
            </p>
          </label>
        </div>

        <div className="flex items-start gap-3 rounded-md border border-red-200 p-3 dark:border-red-900">
          <RadioGroup.Item
            value="immediately"
            id="cancel-immediately"
            className="mt-0.5 h-4 w-4 rounded-full border border-gray-300 data-[state=checked]:border-red-600 data-[state=checked]:bg-red-600"
          >
            <RadioGroup.Indicator className="flex h-full w-full items-center justify-center after:block after:h-2 after:w-2 after:rounded-full after:bg-white" />
          </RadioGroup.Item>
          <label htmlFor="cancel-immediately" className="cursor-pointer">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              Immediately
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Lose access right now. No refund for unused time.
            </p>
          </label>
        </div>
      </RadioGroup.Root>

      {cancelMutation.isError && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Cancellation failed. Please try again.
        </div>
      )}

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Keep subscription
        </Button>
        <Button
          variant="danger"
          isLoading={cancelMutation.isPending}
          onClick={() => cancelMutation.mutate()}
          aria-label={`Cancel subscription ${timing === 'immediately' ? 'immediately' : 'at period end'}`}
        >
          {timing === 'immediately' ? 'Cancel immediately' : 'Cancel at period end'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlanManagement() {
  const queryClient = useQueryClient();
  const [changeTarget, setChangeTarget] = useState<{
    tier: string;
    displayName: string;
    isUpgrade: boolean;
  } | null>(null);
  const [showCancel, setShowCancel] = useState(false);

  const subsQuery = useQuery({
    queryKey: ['subscriptions', 'active'],
    queryFn: async () => {
      const { data } = await api.get<{ data: Subscription[] }>(
        '/subscriptions?status=active&limit=1',
      );
      return data.data[0] ?? null;
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (subId: string) =>
      api.post(`/subscriptions/${subId}/reactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });

  const sub = subsQuery.data;
  const currentTierIndex = sub
    ? PLAN_CARDS.findIndex((p) => p.tier === sub.plan.tier)
    : -1;

  if (subsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-6 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-80 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (subsQuery.isError) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
      >
        <AlertTriangle className="h-4 w-4" />
        Could not load plan information.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Plan Management
        </h1>
        {sub && (
          <p className="mt-1 text-sm text-gray-500">
            Currently on{' '}
            <strong className="text-gray-700 dark:text-gray-300">
              {sub.plan.display_name}
            </strong>{' '}
            <StatusBadge status={sub.status as SubscriptionStatus} />
          </p>
        )}
      </div>

      {/* Reactivation notice */}
      {sub?.cancel_at_period_end && (
        <div className="flex items-center justify-between rounded-lg bg-amber-50 px-4 py-3 dark:bg-amber-900/20">
          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            Your subscription will cancel on{' '}
            {formatDate(sub.current_period_end)}.
          </div>
          <Button
            variant="secondary"
            size="sm"
            isLoading={reactivateMutation.isPending}
            onClick={() => reactivateMutation.mutate(sub.id)}
            aria-label="Reactivate subscription"
          >
            Reactivate
          </Button>
        </div>
      )}

      {/* Plan cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        {PLAN_CARDS.map((plan, idx) => {
          const isCurrent = sub?.plan.tier === plan.tier;
          const isUpgrade = currentTierIndex !== -1 && idx > currentTierIndex;
          const isDowngrade = currentTierIndex !== -1 && idx < currentTierIndex;
          const isEnterprise = plan.tier === 'enterprise';

          return (
            <Card
              key={plan.tier}
              className={cn(
                'relative flex flex-col transition-shadow duration-200',
                isCurrent
                  ? 'border-2 border-green-500 shadow-md'
                  : plan.highlight
                    ? 'border-2 border-indigo-400 shadow-md'
                    : '',
              )}
            >
              {isCurrent && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-green-500 px-3 py-0.5 text-xs font-semibold text-white">
                  Current plan
                </span>
              )}
              {!isCurrent && plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-xs font-semibold text-white">
                  Most popular
                </span>
              )}

              <CardHeader>
                <CardTitle>{plan.display_name}</CardTitle>
                <div className="mt-2">
                  {plan.price_monthly !== null ? (
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">
                      ${plan.price_monthly}
                      <span className="text-base font-normal text-gray-400">
                        /mo
                      </span>
                    </p>
                  ) : (
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      Custom
                    </p>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex-1">
                <ul className="space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500"
                        aria-hidden="true"
                      />
                      <span className="text-gray-600 dark:text-gray-300">{f}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter>
                {isCurrent ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled
                    aria-label={`You are already on the ${plan.display_name} plan`}
                  >
                    Current Plan
                  </Button>
                ) : isEnterprise ? (
                  <a
                    href="mailto:sales@billr.io?subject=Enterprise inquiry"
                    className="block w-full"
                  >
                    <Button
                      variant="secondary"
                      className="w-full"
                      aria-label="Contact sales for Enterprise plan"
                    >
                      Contact Sales
                    </Button>
                  </a>
                ) : (
                  <Button
                    variant={isUpgrade ? 'primary' : 'secondary'}
                    className="w-full"
                    onClick={() =>
                      setChangeTarget({
                        tier: plan.tier,
                        displayName: plan.display_name,
                        isUpgrade: !!isUpgrade,
                      })
                    }
                    aria-label={`${isUpgrade ? 'Upgrade' : isDowngrade ? 'Downgrade' : 'Switch'} to ${plan.display_name}`}
                  >
                    {isUpgrade ? 'Upgrade' : isDowngrade ? 'Downgrade' : plan.cta}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Cancel section */}
      {sub &&
        sub.status !== 'canceled' &&
        !sub.cancel_at_period_end && (
          <div className="border-t border-gray-200 pt-6 dark:border-gray-800">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Cancel subscription
            </p>
            <p className="mt-1 text-sm text-gray-500">
              You can cancel immediately or at the end of your billing period.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-3"
              onClick={() => setShowCancel(true)}
              aria-label="Cancel your Billr subscription"
            >
              Cancel Subscription
            </Button>
          </div>
        )}

      {/* Change plan modal */}
      {changeTarget && sub && (
        <ChangePlanModal
          open={!!changeTarget}
          onClose={() => setChangeTarget(null)}
          targetTier={changeTarget.tier}
          targetDisplayName={changeTarget.displayName}
          isUpgrade={changeTarget.isUpgrade}
          currentPeriodEnd={sub.current_period_end}
          subscriptionId={sub.id}
        />
      )}

      {/* Cancel modal */}
      {sub && (
        <CancelModal
          open={showCancel}
          onClose={() => setShowCancel(false)}
          subscriptionId={sub.id}
          periodEnd={sub.current_period_end}
        />
      )}
    </div>
  );
}
