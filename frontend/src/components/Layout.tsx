import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CreditCard,
  FileText,
  BarChart2,
  Settings,
  Menu,
  X,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { clearStoredApiKey } from '@/lib/api';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Plan', to: '/plans', icon: CreditCard },
  { label: 'Invoices', to: '/invoices', icon: FileText },
  { label: 'Usage', to: '/usage', icon: BarChart2 },
  { label: 'Settings', to: '/settings', icon: Settings },
];

// Read account info from localStorage (set at login)
function getStoredAccountInfo() {
  try {
    const raw = localStorage.getItem('billr_account');
    if (raw) return JSON.parse(raw) as { name: string; email: string };
  } catch {
    // ignore parse error
  }
  return null;
}

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const account = getStoredAccountInfo();

  function handleLogout() {
    clearStoredApiKey();
    localStorage.removeItem('billr_account');
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* ── Mobile overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-white shadow-md',
          'dark:bg-gray-900 dark:border-r dark:border-gray-800',
          'transition-transform duration-200 ease-in-out',
          // On mobile: slide in/out; on desktop: always visible
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:static lg:translate-x-0',
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-gray-100 px-6 dark:border-gray-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600">
            <span className="text-sm font-bold text-white">B</span>
          </div>
          <span className="text-xl font-bold text-gray-900 dark:text-white">
            Billr
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          <ul role="list" className="space-y-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                      'transition-colors duration-150',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn(
                          'h-5 w-5 flex-shrink-0',
                          isActive
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300',
                        )}
                        aria-hidden="true"
                      />
                      {item.label}
                      {isActive && (
                        <ChevronRight
                          className="ml-auto h-4 w-4 text-indigo-400"
                          aria-hidden="true"
                        />
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* User / logout at bottom */}
        <div className="border-t border-gray-100 p-4 dark:border-gray-800">
          {account && (
            <div className="mb-3 px-1">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                {account.name}
              </p>
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                {account.email}
              </p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-label="Log out of Billr"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex h-16 items-center border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="ml-3 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600">
              <span className="text-xs font-bold text-white">B</span>
            </div>
            <span className="text-lg font-bold text-gray-900 dark:text-white">
              Billr
            </span>
          </div>
          {/* Close button (visible when sidebar is open) */}
          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="ml-auto rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Close navigation menu"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}
