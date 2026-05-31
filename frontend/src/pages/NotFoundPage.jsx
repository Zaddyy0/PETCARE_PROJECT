import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 text-slate-900">
      <div className="glass-panel w-full max-w-xl rounded-[2rem] border border-white/80 p-8 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-violet-600">404</p>
        <h1 className="font-display mt-3 text-4xl font-bold text-slate-950">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          The route you tried to open does not exist inside the pet care app.
        </p>
        <Link
          to="/app"
          className="mt-6 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
