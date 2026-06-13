'use client';

import AppShell from '@/components/shell/AppShell';

/**
 * Redesigned workspace (issue #42). Auth is handled by ProtectedLayout; the old
 * Navbar is hidden on this route (see MainLayoutClientWrapper) because the shell
 * provides its own chrome. Routing unification across the app is issue #49.
 */
export default function TodosPage() {
  return <AppShell />;
}
