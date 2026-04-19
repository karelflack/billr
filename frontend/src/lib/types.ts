// ─── Account ─────────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
  email: string;
  billing_address: BillingAddress | null;
  dpa_accepted_at: string | null;
  marketing_consent: boolean;
  created_at: string;
}

export interface BillingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

export type PlanTierName = 'starter' | 'growth' | 'enterprise';

export interface PlanTier {
  id: string;
  name: PlanTierName;
  display_name: string;
  price_monthly: number | null; // null = custom/enterprise
  features: string[];
  limits: PlanLimits;
}

export interface PlanLimits {
  subscriptions: number | null; // null = unlimited
  api_calls_per_month: number | null;
  webhook_endpoints: number | null;
}

export interface Plan {
  id: string;
  tier: PlanTierName;
  display_name: string;
  price_monthly: number | null;
  features: string[];
  limits: PlanLimits;
}

// ─── Subscription ─────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'paused';

export interface Subscription {
  id: string;
  account_id: string;
  plan: Plan;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  stripe_subscription_id: string;
  created_at: string;
}

// ─── Invoice ──────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_amount: number; // in cents
  amount: number;      // in cents
  period_start: string;
  period_end: string;
}

export interface Invoice {
  id: string;
  account_id: string;
  subscription_id: string;
  number: string;
  status: InvoiceStatus;
  amount_due: number;   // in cents
  amount_paid: number;  // in cents
  currency: string;
  period_start: string;
  period_end: string;
  line_items: LineItem[];
  pdf_url: string | null;
  created_at: string;
  due_date: string | null;
}

export interface PaginatedInvoices {
  data: Invoice[];
  has_more: boolean;
  next_cursor: string | null;
}

// ─── Usage ────────────────────────────────────────────────────────────────────

export type UsageMetricName = 'api_calls' | 'seats' | 'subscriptions' | 'webhook_deliveries';

export interface UsageRecord {
  id: string;
  subscription_id: string;
  metric: UsageMetricName;
  quantity: number;
  recorded_at: string;
  idempotency_key: string | null;
}

export interface UsageSummary {
  subscription_id: string;
  metric: UsageMetricName;
  period_start: string;
  period_end: string;
  total_usage: number;
  limit: number | null;
  usage_by_day: UsageByDay[];
}

export interface UsageByDay {
  date: string;  // ISO date string YYYY-MM-DD
  quantity: number;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export type WebhookEvent =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'trial.ending_soon'
  | 'usage.limit_approaching';

export interface WebhookEndpoint {
  id: string;
  account_id: string;
  url: string;
  events: WebhookEvent[];
  is_active: boolean;
  secret: string; // HMAC-SHA256 signing secret
  created_at: string;
}

export type WebhookDeliveryStatus = 'success' | 'failed' | 'pending';

export interface WebhookDelivery {
  id: string;
  endpoint_id: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  http_status: number | null;
  response_body: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  created_at: string;
}

// ─── API responses ────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
  status: number;
}

export interface UpcomingInvoice {
  amount_due: number;
  currency: string;
  period_start: string;
  period_end: string;
  proration_amount: number | null;
}
