import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { APP_NAME } from '../utils/constants';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/pets/new', label: 'Add Pet' },
  { to: '/app/appointments/new', label: 'Book Appointment' },
  { to: '/app/appointments/board', label: 'Track Appointments' }
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/50 bg-slate-950/90 text-white shadow-2xl shadow-slate-950/20 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 text-lg font-bold text-white shadow-lg shadow-fuchsia-500/30">
              P
            </div>
            <div>
              <p className="font-display text-lg font-bold tracking-tight">{APP_NAME}</p>
              <p className="text-xs text-slate-300">A full-stack home for pet care operations</p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200',
                    isActive
                      ? 'bg-white text-slate-950 shadow-lg shadow-white/20'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Signed in as</p>
              <p className="font-semibold text-white">{user?.name}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white hover:text-slate-950"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
