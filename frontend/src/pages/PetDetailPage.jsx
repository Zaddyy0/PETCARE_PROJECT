import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import { useAppData } from '../context/AppDataContext';
import { formatLongDate } from '../utils/formatters';
import { getPetImageSrc } from '../utils/petImage';

export default function PetDetailPage() {
  const navigate = useNavigate();
  const { petId } = useParams();
  const { pets, appointments, removePet, getPetById } = useAppData();
  const [deleting, setDeleting] = useState(false);
  const [pet, setPet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const petAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.pet?._id === petId || appointment.pet === petId),
    [appointments, petId]
  );

  useEffect(() => {
    let active = true;

    async function loadPet() {
      setLoading(true);
      setError('');

      const cachedPet = pets.find((item) => item._id === petId);
      if (cachedPet && active) {
        setPet(cachedPet);
        setLoading(false);
        return;
      }

      try {
        const response = await getPetById(petId);
        if (active) {
          setPet(response);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError?.response?.data?.message || 'This pet profile could not be loaded.');
          setPet(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadPet();

    return () => {
      active = false;
    };
  }, [getPetById, petId, pets]);

  if (loading) {
    return <div className="glass-panel rounded-3xl p-6 text-sm text-slate-600">Loading pet profile...</div>;
  }

  if (error || !pet) {
    return (
      <EmptyState
        title="Pet profile not found"
        message={error || 'This profile may have been deleted or you do not have access to it.'}
        actionLabel="Back to dashboard"
        actionTo="/app"
      />
    );
  }

  const handleDelete = async () => {
    const confirmed = window.confirm('Delete this pet profile and its appointments?');
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      await removePet(petId, { confirmDelete: true });
      navigate('/app', { replace: true });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel overflow-hidden rounded-[2rem] border border-white/80">
        <div className="grid gap-0 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="bg-slate-950 p-6 text-white md:p-8">
            <img
              src={getPetImageSrc(pet.photoUrl, 'https://placehold.co/700x700/e2e8f0/475569?text=Pet')}
              alt={pet.name}
              className="mx-auto h-72 w-full rounded-[1.75rem] object-cover shadow-2xl shadow-slate-950/20"
            />
          </div>
          <div className="p-6 md:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-violet-600">Pet profile</p>
            <h1 className="font-display mt-3 text-4xl font-bold text-slate-950">{pet.name}</h1>
            <p className="mt-2 text-lg text-slate-600">{pet.breed || pet.type}</p>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Type</p>
                <p className="mt-2 font-display text-xl font-bold text-slate-950">{pet.type}</p>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Age</p>
                <p className="mt-2 font-display text-xl font-bold text-slate-950">{pet.age} year{pet.age === 1 ? '' : 's'}</p>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4 md:col-span-2">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Created</p>
                <p className="mt-2 font-semibold text-slate-700">{formatLongDate(pet.createdAt)}</p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={`/app/pets/${pet._id}/edit`} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                Edit profile
              </Link>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-full border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-70"
              >
                {deleting ? 'Deleting...' : 'Delete profile'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-[2rem] border border-white/80 p-6 md:p-8">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-950">Related appointments</h2>
            <p className="mt-1 text-sm text-slate-600">Appointments tied to this pet profile.</p>
          </div>
        </div>

        {petAppointments.length ? (
          <div className="space-y-3">
            {petAppointments.map((appointment) => (
              <div key={appointment._id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{appointment.reason}</p>
                    <p className="text-sm text-slate-600">{formatLongDate(appointment.datetime)}</p>
                  </div>
                  <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-violet-700">
                    {appointment.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No appointments linked to this pet"
            message="Create a new booking to start tracking care visits for this profile."
            actionLabel="Book appointment"
            actionTo="/app/appointments/new"
          />
        )}
      </section>
    </div>
  );
}
