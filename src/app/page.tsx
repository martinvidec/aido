'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';

/**
 * Root entry (issue #49): a thin redirector. Authenticated users go to the
 * redesigned workspace (/todos); everyone else to /login. The old TodoList that
 * used to render here is removed (replaced by the spaces shell).
 */
export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/todos' : '/login');
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-text-dim">
      <span className="text-sm">Lädt …</span>
    </div>
  );
}
