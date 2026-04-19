import { type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from '@/components/Layout';
import CookieBanner from '@/components/CookieBanner';
import { getStoredApiKey } from '@/lib/api';

// ─── Pages (lazy-loaded for code splitting) ───────────────────────────────────
import { lazy, Suspense } from 'react';

const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const PlanManagement = lazy(() => import('@/pages/PlanManagement'));
const InvoiceHistory = lazy(() => import('@/pages/InvoiceHistory'));
const UsageMetrics = lazy(() => import('@/pages/UsageMetrics'));
const BillingSettings = lazy(() => import('@/pages/BillingSettings'));

// ─── Loading fallback ─────────────────────────────────────────────────────────

function PageLoader() {
  return (
    <div
      className="flex h-full items-center justify-center"
      role="status"
      aria-label="Loading page"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
    </div>
  );
}

// ─── Protected route wrapper ──────────────────────────────────────────────────

/**
 * Redirects to /login if the user has no API key stored.
 * Wraps all protected content in the sidebar Layout.
 */
function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const apiKey = getStoredApiKey();

  if (!apiKey) {
    // Preserve the intended destination so we can redirect back after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Layout>{children}</Layout>;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <>
      {/* Cookie banner renders at root level above all routes — LB-014 */}
      <CookieBanner />

      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Root redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* Protected routes — all wrapped in Layout */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/plans"
            element={
              <ProtectedRoute>
                <PlanManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices"
            element={
              <ProtectedRoute>
                <InvoiceHistory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/usage"
            element={
              <ProtectedRoute>
                <UsageMetrics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <BillingSettings />
              </ProtectedRoute>
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
