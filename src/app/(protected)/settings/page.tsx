import { Metadata } from 'next';
import Link from 'next/link';
import UserSettings from '@/components/UserSettings';

export const metadata: Metadata = {
  title: 'Settings | Aido',
  description: 'Manage your account settings and preferences',
};

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="mx-auto mb-4 max-w-3xl px-4">
        <Link href="/todos" className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100">
          ← Zurück zu aido
        </Link>
      </div>
      <UserSettings />
    </main>
  );
}