import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_NAME } from '../utils/constants';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, register, authError, setAuthError } = useAuth();
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setAuthError('');

    try {
      if (mode === 'login') {
        await login({ email: form.email, password: form.password });
      } else {
        await register({ name: form.name, email: form.email, password: form.password });
      }
      navigate('/app', { replace: true });
    } catch (submitError) {
      setError(submitError?.response?.data?.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-6 text-slate-900 md:px-6 md:py-10">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-7xl overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-slate-950/10 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hero-glow relative flex flex-col justify-between overflow-hidden p-8 text-white md:p-12 lg:p-16">
          <div className="absolute -left-16 top-20 h-48 w-48 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="absolute -bottom-10 right-0 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />

          <div className="relative z-10 max-w-xl">
            <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.35em] text-white/70">
              MERN pet management platform
            </div>
            <h1 className="font-display mt-6 text-4xl font-bold leading-tight md:text-5xl xl:text-6xl">
              Build pet profiles, book care, and track every appointment in one place.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-300 md:text-lg">
              {APP_NAME} keeps the original flow of the static app, but turns it into a real authenticated product with a Node, Express, MongoDB, and React stack.
            </p>
          </div>

          <div className="relative z-10 grid gap-4 text-sm text-slate-200 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-white/45">Pets</p>
              <p className="mt-2 font-display text-xl font-bold">Profiles, edits, photos</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-white/45">Appointments</p>
              <p className="mt-2 font-display text-xl font-bold">Book, drag, update status</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-white/45">Auth</p>
              <p className="mt-2 font-display text-xl font-bold">Secure login and signup</p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-slate-50 px-6 py-10 md:px-10">
          <div className="w-full max-w-md">
            <div className="glass-panel rounded-[2rem] border border-white/80 p-6 md:p-8">
              <div className="mb-6 text-center">
                <h2 className="font-display text-3xl font-bold text-slate-950">Welcome back</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Log in with your email and password, or switch to sign up to create a new account.
                </p>
              </div>

              <div className="mb-6 grid grid-cols-2 rounded-full bg-slate-100 p-1 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={`rounded-full px-4 py-2 transition ${mode === 'login' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  className={`rounded-full px-4 py-2 transition ${mode === 'signup' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                >
                  Sign up
                </button>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                {mode === 'signup' ? (
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="name">
                      Full name
                    </label>
                    <input
                      id="name"
                      name="name"
                      value={form.name}
                      onChange={handleChange}
                      required
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                      placeholder="Piyush Bhandari"
                    />
                  </div>
                ) : null}

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={form.password}
                    onChange={handleChange}
                    required
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                    placeholder="Enter your password"
                  />
                </div>

                {(error || authError) ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                    {error || authError}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3.5 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? 'Working...' : mode === 'login' ? 'Log in to dashboard' : 'Create account'}
                </button>

                <button
                  type="button"
                  onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                  className="flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                >
                  {mode === 'login' ? 'Need an account? Create one' : 'Already have an account? Log in'}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
