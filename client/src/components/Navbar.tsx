import { NavLink } from 'react-router-dom';

const links = [
  { to: '/timer', label: 'Timer', icon: '⏱' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

interface Props {
  userEmail: string | null;
  onLogout: () => void;
}

export default function Navbar({ userEmail, onLogout }: Props) {
  return (
    <aside className="hidden md:flex w-52 bg-white border-r border-gray-200 flex-col">
      <div className="px-4 py-5 border-b border-gray-200">
        <h1 className="text-xl font-bold text-blue-600">FTX Clockify</h1>
        <p className="text-xs text-gray-400 mt-0.5">Time Tracker</p>
      </div>

      <nav className="flex-1 py-4 space-y-0.5">
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <span className="text-base">{l.icon}</span>
            {l.label}
          </NavLink>
        ))}
      </nav>

      {/* User / logout */}
      {userEmail && (
        <div className="px-4 py-4 border-t border-gray-200">
          <p className="text-xs text-gray-400 truncate mb-2">{userEmail}</p>
          <button
            onClick={onLogout}
            className="w-full text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 py-1.5 px-2 rounded-lg transition-colors text-left"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
