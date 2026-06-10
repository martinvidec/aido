"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';

interface KeyMetadata {
  exists: boolean;
  keyPrefix?: string | null;
  createdAt?: string | null;
  lastUsedAt?: string | null;
}

// Management UI for the personal API key (issue #21). The plaintext key is
// shown exactly once, right after generation — afterwards only the prefix
// metadata from the server is available.
export default function ApiKeySettings() {
  const { user } = useAuth();
  const [metadata, setMetadata] = useState<KeyMetadata | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const callApi = useCallback(async (method: 'GET' | 'POST' | 'DELETE') => {
    if (!user) throw new Error('Not signed in');
    const token = await user.getIdToken();
    const res = await fetch('/api/user/apiKey', {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    callApi('GET')
      .then(setMetadata)
      .catch((err) => setError(err.message));
  }, [user, callApi]);

  const handleGenerate = async () => {
    if (metadata?.exists && !window.confirm(
      'Generating a new key revokes the current one. Continue?')) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await callApi('POST');
      setFreshKey(result.apiKey);
      setMetadata({ exists: true, keyPrefix: result.keyPrefix, createdAt: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate key');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm('Revoke the API key? Integrations using it will stop working.')) return;
    setBusy(true);
    setError('');
    try {
      await callApi('DELETE');
      setMetadata({ exists: false });
      setFreshKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!freshKey) return;
    await navigator.clipboard.writeText(freshKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">API Key</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Personal key for connecting external tools (e.g. MCP clients) to your account.
      </p>

      {freshKey && (
        <div className="mb-4 p-3 border border-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded-lg">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
            Copy this key now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 p-2 text-xs break-all bg-white dark:bg-gray-900 border dark:border-gray-700 rounded text-gray-900 dark:text-gray-100">
              {freshKey}
            </code>
            <button
              onClick={handleCopy}
              className="px-3 py-2 text-sm bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {metadata === null && !error ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-3">
          {metadata?.exists ? (
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <p>
                Active key: <code className="text-xs">{metadata.keyPrefix}…</code>
              </p>
              {metadata.createdAt && (
                <p className="text-gray-500 dark:text-gray-400">
                  Created {new Date(metadata.createdAt).toLocaleString()}
                  {metadata.lastUsedAt
                    ? `, last used ${new Date(metadata.lastUsedAt).toLocaleString()}`
                    : ', never used'}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No API key yet.</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={busy}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {metadata?.exists ? 'Rotate Key' : 'Generate Key'}
            </button>
            {metadata?.exists && (
              <button
                onClick={handleRevoke}
                disabled={busy}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Revoke
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
