import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import MobileNav from './components/MobileNav';
import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/CalendarPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import { apiFetch, clearToken } from './api';

type AuthState = 'checking' | 'ok' | 'login' | 'register';

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Prevent Ctrl+A from selecting the whole page when focus is outside an input
  useEffect(() => {
    function guard(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        const tag = (document.activeElement as HTMLElement | null)?.tagName ?? '';
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) e.preventDefault();
      }
    }
    document.addEventListener('keydown', guard);
    return () => document.removeEventListener('keydown', guard);
  }, []);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then(r => r.json())
      .then(data => {
        if (data.setupMode) {
          setAuth('register');
        } else if (data.email) {
          setUserEmail(data.email);
          setAuth('ok');
        } else {
          setAuth('login');
        }
      })
      .catch(() => setAuth('login'));
  }, []);

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    clearToken();
    setAuth('login');
    setUserEmail(null);
  }

  if (auth === 'checking') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (auth === 'register') {
    return (
      <RegisterPage
        onRegister={(email) => { setUserEmail(email); setAuth('ok'); }}
        onSwitchToLogin={() => setAuth('login')}
      />
    );
  }

  if (auth === 'login') {
    return (
      <LoginPage
        onLogin={(email) => { setUserEmail(email); setAuth('ok'); }}
        onSwitchToRegister={() => setAuth('register')}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Navbar userEmail={userEmail} onLogout={handleLogout} />
      <main className="flex-1 overflow-hidden pb-14 md:pb-0">
        <Routes>
          <Route path="/" element={<Navigate to="/timer" replace />} />
          <Route path="/timer" element={<Dashboard />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <MobileNav />
    </div>
  );
}
