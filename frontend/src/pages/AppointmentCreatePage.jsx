import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APPOINTMENT_REASONS } from '../utils/constants';
import { useAppData } from '../context/AppDataContext';

const emptyForm = {
  petId: '',
  reason: '',
  datetime: ''
};

export default function AppointmentCreatePage() {
  const navigate = useNavigate();
  const { pets, submitAppointment } = useAppData();
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const petOptions = useMemo(() => pets, [pets]);

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      await submitAppointment(form);
      navigate('/app/appointments/board', { replace: true });
    } catch (submitError) {
      setError(submitError?.response?.data?.message || 'Unable to book the appointment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <section className="glass-panel rounded-[2rem] border border-white/80 p-6 md:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-violet-600">Appointment</p>
        <h1 className="font-display mt-3 text-3xl font-bold text-slate-950">Book a new visit</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Keep the same booking flow from the prototype while persisting the data to MongoDB.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="petId">
              Pet
            </label>
            <select
              id="petId"
              name="petId"
              value={form.petId}
              onChange={handleChange}
              required
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            >
              <option value="">Select your pet</option>
              {petOptions.map((pet) => (
                <option key={pet._id} value={pet._id}>
                  {pet.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="reason">
              Reason for visit
            </label>
            <select
              id="reason"
              name="reason"
              value={form.reason}
              onChange={handleChange}
              required
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            >
              <option value="">Select a reason</option>
              {APPOINTMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="datetime">
              Date and time
            </label>
            <input
              id="datetime"
              name="datetime"
              type="datetime-local"
              value={form.datetime}
              onChange={handleChange}
              required
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            />
          </div>

          {error ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

          <button
            type="submit"
            disabled={loading || !pets.length}
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Booking...' : 'Book appointment'}
          </button>
        </form>
      </section>

      <aside className="hero-glow overflow-hidden rounded-[2rem] p-6 text-white shadow-glow md:p-8">
        <p className="text-xs uppercase tracking-[0.35em] text-white/50">Status</p>
        <h2 className="font-display mt-3 text-3xl font-bold">Scheduled by default</h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          New bookings are created with a scheduled status and can be moved through the tracking board with drag and drop.
        </p>
        <div className="mt-8 space-y-3 text-sm">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">1. Choose a pet</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">2. Pick the care reason</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">3. Set the visit time</div>
        </div>
        {!pets.length ? (
          <div className="mt-6 rounded-3xl border border-amber-200/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            You need at least one pet before booking an appointment.
          </div>
        ) : null}
      </aside>
    </div>
  );
}
