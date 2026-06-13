'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

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
      return <div className="min-h-screen flex items-center justify-center dark:bg-gray-900">Loading...</div>; 
  }

  // Render Login section only if not loading and no user
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="flex flex-col items-center mb-8">
        <Image
          src="/aido_logo_big.png"
          alt="Aido Logo"
          width={240}
          height={240}
          className="rounded-full mb-4"
        />
        <h2 className="text-4xl font-bold text-gray-800 dark:text-gray-100 mb-8">
          Aido
        </h2>
      </div>
      <button
        onClick={signInWithGoogle}
        className="inline-flex items-center px-6 py-3 bg-white border border-gray-300 rounded-md shadow-sm text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-600 dark:focus:ring-offset-gray-900"
      >
        Sign in with Google
      </button>
    </div>
  );
} 