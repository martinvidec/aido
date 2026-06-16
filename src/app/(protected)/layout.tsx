'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Redirect to login page if not loading and no user
    if (!loading && !user) {
      console.log("ProtectedLayout: No user found, redirecting to /login");
      router.push('/login');
    }
  }, [user, loading, router]);

  // While loading or if there's no user (and redirect hasn't happened yet),
  // show a loading indicator or return null.
  if (loading || !user) {
    // You can replace this with a nicer loading spinner component
    return (
        <div className="min-h-screen flex items-center justify-center bg-bg">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
        </div>
    );
  }

  // If loading is done and user exists, render the actual page content
  return <>{children}</>;
} 