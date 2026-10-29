import { useState } from 'react';
import { setToken } from '../api';

interface Props {
  onLogin: (email: string) => void;
  onSwitchToRegister?: () => void;
}

export default function LoginPage({ onLogin, onSwitchToRegister }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.token) {
      setToken(data.token);
      onLogin(data.email);
    } else {
      setError(data.error ?? 'Login failed');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">⏱</div>
          <h1 className="text-2xl font-bold text-gray-900">FTX Clockify</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Email</label>
            <input
              type="email"
              autoFocus
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Your password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
              >
                {showPwd ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {onSwitchToRegister && (
          <p className="text-xs text-center text-gray-400 mt-6">
            No account yet?{' '}
            <button onClick={onSwitchToRegister} className="text-blue-500 hover:underline">
              Create one
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
