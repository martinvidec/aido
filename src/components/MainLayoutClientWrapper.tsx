"use client";

import React from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import Navbar from '@/components/Navbar';
import { usePathname } from 'next/navigation';

/**
 * A client component wrapper that conditionally renders the Navbar
 * based on authentication status and current route.
 */
export default function MainLayoutClientWrapper({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  // Paths where the Navbar should explicitly NOT be shown, regardless of auth state.
  // '/todos' is the redesigned workspace (issue #42) — it ships its own shell
  // chrome (sidebar + space header), so the legacy Navbar is suppressed there.
  // Full routing unification is issue #49.
  const noNavPaths = ['/login', '/signin', '/signup', '/todos'];

  // Determine if the Navbar should be shown:
  // 1. Auth loading must be finished.
  // 2. User must be logged in.
  // 3. Current path must NOT be in the noNavPaths list.
  const showNavbar = !loading && !!user && !noNavPaths.includes(pathname);

  return (
    <>
      {showNavbar && <Navbar />} 
      {children}
    </>
  );
} 