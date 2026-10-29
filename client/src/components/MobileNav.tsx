import { NavLink } from 'react-router-dom';

const links = [
  { to: '/timer', label: 'Timer', icon: '⏱' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function MobileNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex">
        {links.map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`
            }
          >
            <span className="text-xl leading-none">{l.icon}</span>
            <span className="text-xs font-medium">{l.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
