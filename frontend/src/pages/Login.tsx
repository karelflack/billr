import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import * as Label from '@radix-ui/react-label';
import { AlertCircle } from 'lucide-react';
import api, { setStoredApiKey } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// ─── Form field helper ────────────────────────────────────────────────────────

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
}

function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  required,
  autoComplete,
  placeholder,
}: FieldProps) {
  return (
    <div>
      <Label.Root
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label} {required && <span className="text-red-500">*</span>}
      </Label.Root>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={cn(
          'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm',
          'placeholder-gray-400 shadow-sm',
          'focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500',
          'dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500',
        )}
      />
    </div>
  );
}

// ─── API types ────────────────────────────────────────────────────────────────

interface AuthResponse {
  api_key: string;
  account: { id: string; name: string; email: string };
}

// ─── Login form ───────────────────────────────────────────────────────────────

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post<AuthResponse>('/auth/login', {
        email,
        password,
      });
      setStoredApiKey(data.api_key);
      localStorage.setItem('billr_account', JSON.stringify(data.account));
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Invalid email or password.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field
        id="login-email"
        label="Email address"
        type="email"
        value={email}
        onChange={setEmail}
        required
        autoComplete="email"
        placeholder="you@company.com"
      />
      <Field
        id="login-password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        required
        autoComplete="current-password"
      />

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        isLoading={loading}
        aria-label="Log in to Billr"
      >
        Log in
      </Button>
    </form>
  );
}

// ─── Register form ────────────────────────────────────────────────────────────

function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // LB-012: DPA acceptance at signup (LAUNCH BLOCKER)
  const [dpaAccepted, setDpaAccepted] = useState(false);
  // LB-013: ToS checkbox
  const [tosAccepted, setTosAccepted] = useState(false);
  // LB-013: Marketing opt-in (separate from ToS, unchecked by default)
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!tosAccepted) {
      setError('You must accept the Terms of Service to create an account.');
      return;
    }
    if (!dpaAccepted) {
      setError('You must accept the Data Processing Agreement (DPA) to create an account.');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post<AuthResponse>('/auth/register', {
        name,
        email,
        password,
        tos_accepted: tosAccepted,
        dpa_accepted: dpaAccepted,
        marketing_consent: marketingConsent,
      });
      setStoredApiKey(data.api_key);
      localStorage.setItem('billr_account', JSON.stringify(data.account));
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Registration failed. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field
        id="reg-name"
        label="Full name"
        value={name}
        onChange={setName}
        required
        autoComplete="name"
        placeholder="Jane Smith"
      />
      <Field
        id="reg-email"
        label="Email address"
        type="email"
        value={email}
        onChange={setEmail}
        required
        autoComplete="email"
        placeholder="you@company.com"
      />
      <Field
        id="reg-password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        required
        autoComplete="new-password"
        placeholder="12+ characters"
      />

      {/* ToS — LB-013 */}
      <div className="flex items-start gap-3">
        <input
          id="tos"
          type="checkbox"
          checked={tosAccepted}
          onChange={(e) => setTosAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-indigo-600"
          required
          aria-required="true"
        />
        <label
          htmlFor="tos"
          className="text-sm text-gray-600 dark:text-gray-300"
        >
          I agree to the{' '}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline hover:text-indigo-800"
          >
            Terms of Service
          </a>{' '}
          <span className="text-red-500">*</span>
        </label>
      </div>

      {/* DPA — LB-012 (LAUNCH BLOCKER: required for EU customers per magnus) */}
      <div className="flex items-start gap-3">
        <input
          id="dpa"
          type="checkbox"
          checked={dpaAccepted}
          onChange={(e) => setDpaAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-indigo-600"
          required
          aria-required="true"
        />
        <label
          htmlFor="dpa"
          className="text-sm text-gray-600 dark:text-gray-300"
        >
          I accept the{' '}
          <a
            href="/dpa"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline hover:text-indigo-800"
          >
            Data Processing Agreement
          </a>{' '}
          (required for GDPR compliance){' '}
          <span className="text-red-500">*</span>
        </label>
      </div>

      {/* Marketing opt-in — LB-013 (separate, unchecked by default) */}
      <div className="flex items-start gap-3">
        <input
          id="marketing"
          type="checkbox"
          checked={marketingConsent}
          onChange={(e) => setMarketingConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-indigo-600"
        />
        <label
          htmlFor="marketing"
          className="text-sm text-gray-600 dark:text-gray-300"
        >
          Send me product updates and news (optional — you can unsubscribe any
          time)
        </label>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        isLoading={loading}
        aria-label="Create your Billr account"
      >
        Create account
      </Button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 shadow-lg">
            <span className="text-xl font-bold text-white">B</span>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
            Billr
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Billing for Product Engineers
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <Tabs.Root defaultValue="login">
            <Tabs.List
              className="mb-6 flex rounded-md bg-gray-100 p-1 dark:bg-gray-800"
              aria-label="Login or Register"
            >
              <Tabs.Trigger
                value="login"
                className={cn(
                  'flex-1 rounded px-3 py-1.5 text-sm font-medium transition-all',
                  'text-gray-600 dark:text-gray-400',
                  'data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm',
                  'dark:data-[state=active]:bg-gray-700 dark:data-[state=active]:text-white',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                )}
              >
                Log in
              </Tabs.Trigger>
              <Tabs.Trigger
                value="register"
                className={cn(
                  'flex-1 rounded px-3 py-1.5 text-sm font-medium transition-all',
                  'text-gray-600 dark:text-gray-400',
                  'data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm',
                  'dark:data-[state=active]:bg-gray-700 dark:data-[state=active]:text-white',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                )}
              >
                Register
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="login">
              <LoginForm />
            </Tabs.Content>
            <Tabs.Content value="register">
              <RegisterForm />
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </div>
  );
}
