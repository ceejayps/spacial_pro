import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

const navItems = [
  { label: 'Home', icon: 'home', to: '/library' },
  { label: 'Scanner', icon: 'view_in_ar', to: '/scan' },
  { label: 'Library', icon: 'folder', to: '/library' },
];

export default function BottomNav({ fixed = false }: { fixed?: boolean }) {
  const { signOut } = useAuth();
  const wrapperPosition = fixed ? 'fixed bottom-0 left-0 right-0' : '';

  return (
    <div
      className={`${wrapperPosition} safe-area-x z-30 flex gap-2 border-t border-slate-800 bg-background-dark px-4 pt-2 pb-[calc(var(--safe-area-bottom)+0.75rem)]`}
    >
      {navItems.map((item) => (
        <NavLink
          key={item.label}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-1 ${
              isActive ? 'text-primary' : 'text-slate-400 hover:text-white'
            }`
          }
        >
          <span
            className="material-symbols-outlined"
            style={item.icon === 'view_in_ar' ? { fontVariationSettings: `'FILL' 1` } : undefined}
          >
            {item.icon}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        onClick={signOut}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-slate-400 transition-colors hover:text-white"
      >
        <span className="material-symbols-outlined">logout</span>
        <span className="text-[10px] font-bold uppercase tracking-wider">Logout</span>
      </button>
    </div>
  );
}
