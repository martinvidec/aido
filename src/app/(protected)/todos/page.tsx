'use client';

import AppShell from '@/components/shell/AppShell';

/**
 * Redesigned workspace (issue #42). Auth is handled by ProtectedLayout; the
 * shell (AppShell) provides its own chrome (sidebar / bottom tabs). This is the
 * post-login landing route (see app/page.tsx + login redirect).
 */
export default function TodosPage() {
  return <AppShell />;
}
