import { useState, useEffect } from 'react';
import { Cookie } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// LB-014: Cookie consent banner (magnus compliance requirement)

const CONSENT_KEY = 'cookie_consent';
// Bump this version number whenever the cookie policy changes
const POLICY_VERSION = '1.0';

interface CookieConsent {
  version: string;
  accepted_at: string; // ISO timestamp
  essential: true;     // always true — these cannot be declined
  analytics: boolean;
}

function getStoredConsent(): CookieConsent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CookieConsent;
  } catch {
    return null;
  }
}

function storeConsent(analytics: boolean): void {
  const consent: CookieConsent = {
    version: POLICY_VERSION,
    accepted_at: new Date().toISOString(),
    essential: true,
    analytics,
  };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
}

/**
 * Returns true if the user has consented to analytics cookies.
 * Safe to call at any time — returns false if no consent stored.
 */
export function hasAnalyticsConsent(): boolean {
  const consent = getStoredConsent();
  return consent?.analytics === true && consent.version === POLICY_VERSION;
}

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = getStoredConsent();
    // Show banner if no consent stored or policy version changed
    if (!stored || stored.version !== POLICY_VERSION) {
      setVisible(true);
    }
  }, []);

  function handleEssentialOnly() {
    storeConsent(false);
    setVisible(false);
  }

  function handleAcceptAll() {
    storeConsent(true);
    setVisible(false);
    // If analytics was already blocked, reload so tracking initialises
    window.location.reload();
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white px-4 py-4 shadow-lg dark:border-gray-700 dark:bg-gray-900 sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-md sm:rounded-lg sm:border"
    >
      <div className="flex items-start gap-3">
        <Cookie
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-600"
          aria-hidden="true"
        />
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            We use cookies
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Essential cookies keep the app working. We also use optional
            analytics cookies to improve your experience.{' '}
            <a
              href="/settings#cookies"
              className="text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400"
            >
              Cookie preferences
            </a>
          </p>

          {/* Granular description */}
          <ul className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
            <li>
              <span className="font-medium text-gray-700 dark:text-gray-200">
                Essential
              </span>{' '}
              — authentication, security, session (always on)
            </li>
            <li>
              <span className="font-medium text-gray-700 dark:text-gray-200">
                Analytics
              </span>{' '}
              — usage metrics, error tracking (opt-in)
            </li>
          </ul>

          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleEssentialOnly}
              aria-label="Accept essential cookies only"
            >
              Essential only
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAcceptAll}
              aria-label="Accept all cookies including analytics"
            >
              Accept all
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
