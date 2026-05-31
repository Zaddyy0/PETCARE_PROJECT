import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import PetCard from '../components/PetCard';
import { useAuth } from '../context/AuthContext';
import { useAppData } from '../context/AppDataContext';
import { formatDateTime } from '../utils/formatters';

export default function DashboardPage() {
  const { user } = useAuth();
  const { pets, appointments, loading, dataError } = useAppData();

  const upcomingAppointments = appointments.filter((appointment) => appointment.status !== 'completed');
  const completedAppointments = appointments.filter((appointment) => appointment.status === 'completed');

  return (
    <div className="space-y-8">
      <section className="glass-panel rounded-[2rem] border border-white/80 p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-violet-600">Dashboard</p>
            <h1 className="font-display mt-3 text-3xl font-bold text-slate-950 md:text-4xl">
              Welcome back, {user?.name?.split(' ')[0] || 'there'}.
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
              This dashboard keeps the original pet care flow intact: manage pets, book visits, and move appointments through their lifecycle.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/app/pets/new" className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
              Add pet
            </Link>
            <Link to="/app/appointments/new" className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:border-violet-300 hover:text-violet-700">
              Book appointment
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl bg-slate-950 p-5 text-white">
            <p className="text-xs uppercase tracking-[0.3em] text-white/45">Pets</p>
            <p className="mt-3 font-display text-3xl font-bold">{pets.length}</p>
            <p className="mt-1 text-sm text-white/70">Registered profiles</p>
          </div>
          <div className="rounded-3xl bg-violet-600 p-5 text-white">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Upcoming</p>
            <p className="mt-3 font-display text-3xl font-bold">{upcomingAppointments.length}</p>
            <p className="mt-1 text-sm text-white/80">Scheduled or ongoing visits</p>
          </div>
          <div className="rounded-3xl bg-cyan-500 p-5 text-slate-950">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-700/60">Completed</p>
            <p className="mt-3 font-display text-3xl font-bold">{completedAppointments.length}</p>
            <p className="mt-1 text-sm text-slate-800/80">Finished care visits</p>
          </div>
        </div>
      </section>

      {dataError ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700">
          {dataError}
        </div>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-950">Your pets</h2>
            <p className="mt-1 text-sm text-slate-600">Click a card to open the profile page.</p>
          </div>
          <Link to="/app/pets/new" className="text-sm font-semibold text-violet-700 hover:text-violet-800">
            Manage pets
          </Link>
        </div>

        {loading ? (
          <div className="rounded-3xl glass-panel p-6 text-sm text-slate-600">Loading pets and appointments...</div>
        ) : pets.length ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {pets.map((pet) => (
              <PetCard key={pet._id} pet={pet} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No pets yet"
            message="Add your first pet to unlock the dashboard, appointments, and tracking experience."
            actionLabel="Create pet profile"
            actionTo="/app/pets/new"
          />
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="glass-panel rounded-[2rem] border border-white/80 p-6">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold text-slate-950">Recent appointments</h2>
              <p className="mt-1 text-sm text-slate-600">Latest care bookings across your account.</p>
            </div>
            <Link to="/app/appointments/board" className="text-sm font-semibold text-violet-700 hover:text-violet-800">
              Open board
            </Link>
          </div>

          <div className="space-y-3">
            {appointments.slice(0, 4).map((appointment) => (
              <div key={appointment._id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-950">{appointment.pet?.name || appointment.petName}</p>
                    <p className="text-sm text-slate-600">{appointment.reason}</p>
                  </div>
                  <p className="text-right text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                    {formatDateTime(appointment.datetime)}
                  </p>
                </div>
              </div>
            ))}
            {!appointments.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                Your bookings will appear here after you create one.
              </div>
            ) : null}
          </div>
        </div>

        <div className="hero-glow overflow-hidden rounded-[2rem] p-6 text-white shadow-glow">
          <p className="text-xs uppercase tracking-[0.35em] text-white/50">Workflow</p>
          <h3 className="font-display mt-3 text-2xl font-bold">Original flow, real backend</h3>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            The static prototype’s behaviors are now powered by Express, MongoDB, authentication, and structured data handling.
          </p>
          <div className="mt-6 space-y-3 text-sm text-slate-200">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">1. Create or log in to a user</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">2. Add pets and upload photos</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">3. Book care and drag appointment status</div>
          </div>
        </div>
      </section>
    </div>
  );
}
