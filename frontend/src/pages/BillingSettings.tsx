import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, CheckCircle2 } from 'lucide-react';
import * as Switch from '@radix-ui/react-switch';
import * as Label from '@radix-ui/react-label';
import api from '@/lib/api';
import type { Account, BillingAddress } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';

// ─── Text input helper ────────────────────────────────────────────────────────

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
}

function Field({
  id,
  label,
  value,
  onChange,
  required,
  placeholder,
  autoComplete,
}: FieldProps) {
  return (
    <div>
      <Label.Root
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}{' '}
        {required && <span className="text-red-500" aria-hidden="true">*</span>}
      </Label.Root>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={cn(
          'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm',
          'shadow-sm placeholder-gray-400',
          'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500',
          'dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500',
        )}
      />
    </div>
  );
}

// ─── Toast notification ───────────────────────────────────────────────────────

function SuccessToast({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
    >
      <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      {message}
    </div>
  );
}

function ErrorToast({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      {message}
    </div>
  );
}

// ─── Billing address form ─────────────────────────────────────────────────────

interface AddressFormProps {
  accountId: string;
  initialAddress: BillingAddress | null;
}

function AddressForm({ accountId, initialAddress }: AddressFormProps) {
  const [form, setForm] = useState<BillingAddress>(
    initialAddress ?? {
      line1: '',
      line2: '',
      city: '',
      state: '',
      postal_code: '',
      country: '',
    },
  );
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const set = (key: keyof BillingAddress) => (v: string) =>
    setForm((prev) => ({ ...prev, [key]: v }));

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/accounts/${accountId}`, { billing_address: form }),
    onSuccess: () => setStatus('success'),
    onError: () => setStatus('error'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('idle');
    saveMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Billing address">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            id="addr-line1"
            label="Address line 1"
            value={form.line1}
            onChange={set('line1')}
            required
            autoComplete="address-line1"
            placeholder="123 Main St"
          />
        </div>
        <div className="sm:col-span-2">
          <Field
            id="addr-line2"
            label="Address line 2"
            value={form.line2 ?? ''}
            onChange={set('line2')}
            autoComplete="address-line2"
            placeholder="Suite 400 (optional)"
          />
        </div>
        <Field
          id="addr-city"
          label="City"
          value={form.city}
          onChange={set('city')}
          required
          autoComplete="address-level2"
        />
        <Field
          id="addr-state"
          label="State / Province"
          value={form.state}
          onChange={set('state')}
          autoComplete="address-level1"
        />
        <Field
          id="addr-postal"
          label="Postal code"
          value={form.postal_code}
          onChange={set('postal_code')}
          required
          autoComplete="postal-code"
        />
        <Field
          id="addr-country"
          label="Country"
          value={form.country}
          onChange={set('country')}
          required
          autoComplete="country-name"
          placeholder="United States"
        />
      </div>

      {status === 'success' && <SuccessToast message="Billing address saved." />}
      {status === 'error' && (
        <ErrorToast message="Failed to save address. Please try again." />
      )}

      <Button
        type="submit"
        variant="primary"
        size="sm"
        isLoading={saveMutation.isPending}
        aria-label="Save billing address"
      >
        Save changes
      </Button>
    </form>
  );
}

// ─── DPA acceptance ───────────────────────────────────────────────────────────
// LB-012: Data Processing Agreement checkbox in settings if not yet accepted

interface DpaAcceptanceProps {
  accountId: string;
  acceptedAt: string | null;
}

function DpaAcceptance({ accountId, acceptedAt }: DpaAcceptanceProps) {
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(!!acceptedAt);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/accounts/${accountId}/accept-dpa`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account'] });
    },
  });

  if (acceptedAt || accepted) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Data Processing Agreement accepted
        {acceptedAt && (
          <span className="text-gray-400">
            ({new Date(acceptedAt).toLocaleDateString()})
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
        Data Processing Agreement (DPA) required
      </p>
      <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
        Required for GDPR compliance if you process EU personal data.{' '}
        <a
          href="/dpa"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-900"
        >
          Read DPA
        </a>
      </p>
      <div className="mt-3 flex items-center gap-3">
        <input
          id="dpa-accept"
          type="checkbox"
          checked={accepted}
          onChange={(e) => {
            setAccepted(e.target.checked);
            if (e.target.checked) mutation.mutate();
          }}
          className="h-4 w-4 rounded border-gray-300 accent-indigo-600"
          aria-label="Accept the Data Processing Agreement"
        />
        <label htmlFor="dpa-accept" className="text-sm text-amber-800 dark:text-amber-300">
          I accept the Data Processing Agreement
        </label>
      </div>
      {mutation.isError && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          Failed to record DPA acceptance. Please try again.
        </p>
      )}
    </div>
  );
}

// ─── Marketing consent toggle ─────────────────────────────────────────────────
// LB-013: Marketing consent is separate from ToS — GDPR requires granular opt-in

interface MarketingConsentProps {
  accountId: string;
  currentValue: boolean;
}

function MarketingConsentToggle({ accountId, currentValue }: MarketingConsentProps) {
  const [enabled, setEnabled] = useState(currentValue);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (value: boolean) =>
      api.patch(`/accounts/${accountId}`, { marketing_consent: value }),
    onSuccess: () => setSaved(true),
    onError: () => setEnabled(currentValue), // revert on error
  });

  function handleChange(checked: boolean) {
    setEnabled(checked);
    setSaved(false);
    mutation.mutate(checked);
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label.Root
          htmlFor="marketing-toggle"
          className="text-sm font-medium text-gray-900 dark:text-white"
        >
          Marketing emails
        </Label.Root>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Product updates, tips, and announcements. Unsubscribe any time.
        </p>
        {saved && (
          <p
            className="mt-1 text-xs text-green-600 dark:text-green-400"
            role="status"
            aria-live="polite"
          >
            Preference saved.
          </p>
        )}
      </div>
      <Switch.Root
        id="marketing-toggle"
        checked={enabled}
        onCheckedChange={handleChange}
        className={cn(
          'relative inline-flex h-6 w-11 cursor-pointer rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
          enabled
            ? 'bg-indigo-600'
            : 'bg-gray-200 dark:bg-gray-700',
        )}
        aria-label="Toggle marketing email consent"
      >
        <Switch.Thumb
          className={cn(
            'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm',
            'transition-transform duration-150',
            'translate-x-0.5 data-[state=checked]:translate-x-[22px]',
          )}
        />
      </Switch.Root>
    </div>
  );
}

// ─── Delete account modal ─────────────────────────────────────────────────────

interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
  accountId: string;
}

function DeleteAccountModal({ open, onClose, accountId }: DeleteAccountModalProps) {
  const [confirmText, setConfirmText] = useState('');

  const deleteMutation = useMutation({
    mutationFn: () => api.post(`/accounts/${accountId}/delete`),
    onSuccess: () => {
      // GDPR erasure — wipe local state and redirect to login
      localStorage.clear();
      window.location.href = '/login?deleted=true';
    },
  });

  const canConfirm = confirmText === 'DELETE';

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Delete Account"
      description="This permanently deletes your Billr account and all associated data (GDPR erasure). This cannot be undone."
    >
      <div className="space-y-4">
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <strong>Warning:</strong> All subscriptions, invoices, usage records,
          and webhook configurations will be permanently deleted.
        </div>

        <div>
          <label
            htmlFor="delete-confirm"
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Type <code className="font-mono font-bold">DELETE</code> to confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className={cn(
              'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm',
              'focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500',
              'dark:border-gray-600 dark:bg-gray-800 dark:text-white',
            )}
            placeholder="DELETE"
            autoComplete="off"
            aria-describedby="delete-confirm-hint"
          />
          <p
            id="delete-confirm-hint"
            className="mt-1 text-xs text-gray-400"
          >
            This action is irreversible.
          </p>
        </div>

        {deleteMutation.isError && (
          <ErrorToast message="Account deletion failed. Please contact support." />
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={!canConfirm}
          isLoading={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
          aria-label="Permanently delete account"
        >
          Delete my account
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BillingSettings() {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const accountQuery = useQuery({
    queryKey: ['account'],
    queryFn: async () => {
      const { data } = await api.get<Account>('/accounts/me');
      return data;
    },
  });

  async function handleOpenStripePortal() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const { data } = await api.post<{ url: string }>('/billing/portal', {
        return_url: window.location.href,
      });
      window.location.href = data.url;
    } catch {
      setPortalError('Could not open billing portal. Please try again.');
    } finally {
      setPortalLoading(false);
    }
  }

  if (accountQuery.isLoading) {
    return (
      <div className="space-y-6">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
      >
        <AlertTriangle className="h-4 w-4" />
        Could not load account settings.
      </div>
    );
  }

  const account = accountQuery.data;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
        Billing Settings
      </h1>

      {/* Payment method */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Method</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-500">
            Manage your card and payment preferences securely via Stripe.
          </p>
          {portalError && <ErrorToast message={portalError} />}
          <Button
            variant="secondary"
            onClick={handleOpenStripePortal}
            isLoading={portalLoading}
            aria-label="Open Stripe Customer Portal to manage payment method"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Manage Payment Method
          </Button>
        </CardContent>
      </Card>

      {/* Billing address */}
      <Card>
        <CardHeader>
          <CardTitle>Billing Address</CardTitle>
        </CardHeader>
        <CardContent>
          <AddressForm
            accountId={account.id}
            initialAddress={account.billing_address}
          />
        </CardContent>
      </Card>

      {/* DPA acceptance — LB-012 */}
      <Card>
        <CardHeader>
          <CardTitle>Data Processing Agreement</CardTitle>
        </CardHeader>
        <CardContent>
          <DpaAcceptance
            accountId={account.id}
            acceptedAt={account.dpa_accepted_at}
          />
        </CardContent>
      </Card>

      {/* Marketing consent — LB-013 */}
      <Card>
        <CardHeader>
          <CardTitle>Communication Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MarketingConsentToggle
            accountId={account.id}
            currentValue={account.marketing_consent}
          />
          <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
            <p className="text-xs text-gray-400">
              {/* Link to cookie preferences (LB-014) */}
              <a
                href="/settings#cookies"
                className="text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400"
              >
                Cookie preferences
              </a>{' '}
              — manage analytics and tracking cookies.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-red-200 dark:border-red-900" id="delete-account">
        <CardHeader>
          <CardTitle className="text-red-700 dark:text-red-400">
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Permanently delete your account and all data. This triggers a GDPR
            data erasure request and cannot be undone.
          </p>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowDeleteModal(true)}
            aria-label="Delete your Billr account"
          >
            Delete Account
          </Button>
        </CardContent>
      </Card>

      <DeleteAccountModal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        accountId={account.id}
      />
    </div>
  );
}
