"use client";

import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useError } from '@/lib/hooks/useError';
import { useTheme } from '@/lib/contexts/ThemeContext';
import Image from 'next/image';

interface UserSettingsState {
  displayName: string;
  email: string;
  photoURL: string;
  notifications: {
    email: boolean;
    push: boolean;
  };
  language: string;
  timezone: string;
}

type ThemeValue = 'light' | 'dark' | 'system';

export default function UserSettings() {
  const { user } = useAuth();
  const { reportError } = useError();
  const { theme, setTheme } = useTheme();

  const [settings, setSettings] = useState<UserSettingsState>({
    displayName: '',
    email: '',
    photoURL: '',
    notifications: {
      email: true,
      push: true,
    },
    language: 'en',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      if (!user) return;
      setLoading(true);
      setError('');
      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          setSettings(prev => ({
            ...prev,
            displayName: data.displayName || user.displayName || '',
            email: data.email || user.email || '',
            photoURL: data.photoURL || user.photoURL || '',
            notifications: data.notifications || { email: true, push: true },
            language: data.language || 'en',
            timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          }));
          const firestoreTheme = data.theme || 'system';
          console.log("Setting theme from Firestore:", firestoreTheme);
          setTheme(firestoreTheme);
        } else {
           setSettings(prev => ({
               ...prev,
               displayName: user.displayName || '',
               email: user.email || '',
               photoURL: user.photoURL || '',
               timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
           }));
           console.log("User doc not found, using default system theme");
           setTheme('system');
        }
      } catch (error) {
        console.error('Error fetching user settings:', error);
        setError('Failed to load settings');
        if (error instanceof Error) {
          reportError(error, { component: 'UserSettings', operation: 'fetchSettings' });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [user, reportError, setTheme]);

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: settings.displayName,
        email: settings.email,
        photoURL: settings.photoURL,
        notifications: settings.notifications,
        language: settings.language,
        timezone: settings.timezone,
        updatedAt: new Date(),
      });
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setError('Failed to save settings');
      if (error instanceof Error) {
        reportError(error, { component: 'UserSettings', operation: 'handleSave' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleThemeChange = async (mode: ThemeValue) => {
    if (!user) return;
    setTheme(mode);
    try {
      await updateDoc(doc(db, 'users', user.uid), { theme: mode });
      console.log(`Theme preference ${mode} saved to Firestore.`);
    } catch (err) {
       console.error("Failed to save theme preference to Firestore:", err);
       setError('Failed to save theme preference.');
       if (err instanceof Error) {
         reportError(err, { component: 'UserSettings', operation: 'saveThemePreference', newTheme: mode });
       }
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 dark:border-blue-400"></div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">User Settings</h1>

      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Profile</h2>
          <div className="space-y-4">
            <div className="flex items-center space-x-4">
              <div className="relative w-20 h-20 rounded-full overflow-hidden border dark:border-gray-700">
                {settings.photoURL ? (
                  <Image
                    src={settings.photoURL}
                    alt="Profile"
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    priority
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                    <span className="text-2xl text-gray-500 dark:text-gray-300">
                      {settings.displayName?.[0]?.toUpperCase() || '?'}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <label htmlFor="displayName" className="sr-only">Display Name</label>
                <input
                  id="displayName"
                  type="text"
                  value={settings.displayName}
                  onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
                  placeholder="Display Name"
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
                />
              </div>
            </div>
            <div>
              <label htmlFor="email" className="sr-only">Email</label>
              <input
                id="email"
                type="email"
                value={settings.email}
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                placeholder="Email"
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
              />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Preferences</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Theme
              </label>
              <div className="flex items-center space-x-4">
                {(['light', 'dark', 'system'] as const).map((mode) => (
                  <label key={mode} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="theme"
                      value={mode}
                      checked={theme === mode}
                      onChange={() => handleThemeChange(mode)}
                      className="form-radio h-4 w-4 text-blue-600 transition duration-150 ease-in-out focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
                      {mode}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="language" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Language
              </label>
              <select
                id="language"
                value={settings.language}
                onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
              >
                <option value="en">English</option>
                <option value="de">German</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
              </select>
            </div>

            <div>
              <label htmlFor="timezone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Timezone
              </label>
              <select
                id="timezone"
                value={settings.timezone}
                onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700"
              >
                {Intl.supportedValuesOf('timeZone').map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Notifications</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Email Notifications
              </label>
              <input
                type="checkbox"
                checked={settings.notifications.email}
                onChange={(e) => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, email: e.target.checked }
                })}
                className="form-checkbox h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Push Notifications
              </label>
              <input
                type="checkbox"
                checked={settings.notifications.push}
                onChange={(e) => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, push: e.target.checked }
                })}
                className="form-checkbox h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 px-4 py-3 rounded relative" role="alert">
            <span className="block sm:inline">{error}</span>
          </div>
        )}
        {success && (
          <div className="bg-green-100 dark:bg-green-900 border border-green-400 dark:border-green-700 text-green-700 dark:text-green-200 px-4 py-3 rounded relative" role="alert">
            <span className="block sm:inline">{success}</span>
            <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setSuccess('')}>
              <svg className="fill-current h-6 w-6 text-green-500 dark:text-green-300" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
            </span>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}