import { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { Settings } from '../types';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showClockifyKey, setShowClockifyKey] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    apiFetch('/api/settings').then(r => r.json()).then(setSettings);
    apiFetch('/api/settings/has-password').then(r => r.json()).then(d => setHasPassword(d.hasPassword));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const body: Record<string, string> = {
      user_email: settings.user_email ?? '',
      jira_base_url: settings.jira_base_url ?? '',
      jira_token: settings.jira_token ?? '',
    };
    if (password) body.user_password = password;
    if (settings.clockify_api_key !== undefined) body.clockify_api_key = settings.clockify_api_key;
    await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (password) setHasPassword(true);
    setPassword('');
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleClockifySync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await apiFetch('/api/clockify/sync', { method: 'POST' });
    const data = await res.json();
    setSyncing(false);
    if (data.ok) {
      let message = '';
      if (data.added > 0) message += `Added ${data.added} entries. `;
      if (data.updated > 0) message += `Updated ${data.updated} entries. `;
      if (data.added === 0 && data.updated === 0) message = 'No new or changed entries.';
      message += '(Billable entries imported as synced)';
      setSyncResult({ ok: true, message });
    } else {
      setSyncResult({ ok: false, message: data.error ?? 'Sync failed' });
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const res = await apiFetch('/api/jira/test', { method: 'POST' });
    const data = await res.json();
    setTestResult({
      ok: data.ok,
      message: data.ok ? `Connected as ${data.displayName} (${data.email})` : data.error,
    });
    setTesting(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="overflow-y-auto flex-1">
        <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-5">
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>

      {/* Profile */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <span>👤</span> Profile
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Email address</label>
            <input
              type="email"
              autoComplete="off"
              value={settings.user_email ?? ''}
              onChange={e => setSettings({ ...settings, user_email: e.target.value })}
              placeholder="you@company.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">This is also used as your Jira account email.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Password {hasPassword && <span className="text-xs font-normal text-green-600 ml-1">● saved</span>}
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={hasPassword ? 'Enter new password to change' : 'Set a password'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
              >
                {showPwd ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Jira */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <span>🎯</span> Jira Integration
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Jira Base URL</label>
            <input
              type="url"
              autoComplete="off"
              value={settings.jira_base_url ?? ''}
              onChange={e => setSettings({ ...settings, jira_base_url: e.target.value })}
              placeholder="https://your-org.atlassian.net"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Jira API Token</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                autoComplete="new-password"
                value={settings.jira_token ?? ''}
                onChange={e => setSettings({ ...settings, jira_token: e.target.value })}
                placeholder="Your Jira API token"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Generate at{' '}
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
                className="text-blue-500 hover:underline"
              >
                id.atlassian.com → API tokens
              </a>
            </p>
          </div>
        </div>

        {testResult && (
          <div className={`mt-4 px-3 py-2 rounded-lg text-sm ${testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
      </div>

      {/* Clockify */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-700 mb-1 flex items-center gap-2">
          <span>🕐</span> Clockify Integration
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Imports entries from the last month. Billable entries are imported as already-synced to Jira.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Clockify API Key</label>
            <div className="relative">
              <input
                type={showClockifyKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={settings.clockify_api_key ?? ''}
                onChange={e => setSettings({ ...settings, clockify_api_key: e.target.value })}
                placeholder="Your Clockify API key"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowClockifyKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
              >
                {showClockifyKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Find it under{' '}
              <a
                href="https://app.clockify.me/user/settings"
                target="_blank"
                rel="noreferrer"
                className="text-blue-500 hover:underline"
              >
                Clockify → Profile Settings → API
              </a>
            </p>
          </div>
        </div>

        {syncResult && (
          <div className={`mt-4 px-3 py-2 rounded-lg text-sm ${syncResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {syncResult.ok ? '✓ ' : '✕ '}{syncResult.message}
          </div>
        )}

        <div className="mt-5">
          <button
            onClick={handleClockifySync}
            disabled={syncing || !settings.clockify_api_key}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {syncing ? 'Syncing…' : 'Sync from Clockify'}
          </button>
          {syncing && (
            <span className="ml-3 text-xs text-gray-400">Fetching entries, please wait…</span>
          )}
        </div>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
      </button>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">Sync rules</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Description must start with <code className="bg-amber-100 px-1 rounded">TICKET-123 | description</code></li>
          <li>Ticket must exist in Jira</li>
          <li>Ticket must be assigned to you</li>
          <li>Ticket must not be in <strong>BACKLOG</strong> state</li>
          <li>Unsyncing does <em>not</em> delete the worklog from Jira</li>
        </ul>
      </div>
        </div>
      </div>
    </div>
  );
}
