'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import DeviceLoginPanel from './DeviceLoginPanel';

export default function LoginPage() {
  const { user, signInWithGoogle, loading } = useAuth();
  const router = useRouter();

  // Redirect if user is already logged in
  useEffect(() => {
    if (!loading && user) {
      router.push('/todos'); // Redirect to the redesigned workspace if logged in
    }
  }, [user, loading, router]);

  // Show loading indicator or null while checking auth state
  if (loading || user) {
      // Or a loading spinner
      return <div className="min-h-screen flex items-center justify-center bg-bg text-text">Loading...</div>;
  }

  // Render Login section only if not loading and no user
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg">
      <div className="flex flex-col items-center mb-8">
        <Image
          src="/aido_logo_big.png"
          alt="Aido Logo"
          width={240}
          height={240}
          className="rounded-full mb-4"
        />
        <h2 className="text-4xl font-bold text-text mb-8">
          Aido
        </h2>
      </div>
      <button
        onClick={signInWithGoogle}
        className="inline-flex items-center px-6 py-3 bg-bg-card border border-border rounded-md shadow-sm text-base font-medium text-text hover:bg-row-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg focus:ring-accent"
      >
        Sign in with Google
      </button>

      <div className="flex items-center gap-3 my-6 w-full max-w-xs text-text-dim">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide">oder</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <DeviceLoginPanel />
    </div>
  );
} 