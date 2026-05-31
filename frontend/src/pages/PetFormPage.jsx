import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PET_TYPES } from '../utils/constants';
import { useAppData } from '../context/AppDataContext';
import { getPetImageSrc } from '../utils/petImage';

const emptyForm = {
  name: '',
  type: '',
  breed: '',
  age: '',
  photoUrl: ''
};

export default function PetFormPage({ mode }) {
  const navigate = useNavigate();
  const { petId } = useParams();
  const { pets, getPetById, submitPet } = useAppData();
  const [form, setForm] = useState(emptyForm);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [existingPhoto, setExistingPhoto] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEditMode = useMemo(() => mode === 'edit', [mode]);

  useEffect(() => {
    let active = true;

    async function loadPet() {
      if (!isEditMode || !petId) {
        return;
      }

      setLoading(true);
      try {
        const pet = pets.find((item) => item._id === petId) || (await getPetById(petId));
        if (active) {
          setForm({
            name: pet.name || '',
            type: pet.type || '',
            breed: pet.breed || '',
            age: pet.age || '',
            photoUrl: pet.photoUrl || ''
          });
          setExistingPhoto(pet.photoUrl || '');
        }
      } catch (loadError) {
        if (active) {
          setError(loadError?.response?.data?.message || 'Unable to load the pet profile.');
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
  }, [getPetById, isEditMode, petId, pets]);

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    setPhotoFile(file || null);
  };

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl('');
      return;
    }

    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [photoFile]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('name', form.name);
      formData.append('type', form.type);
      formData.append('breed', form.breed);
      formData.append('age', form.age);
      if (photoFile) {
        formData.append('photo', photoFile);
      }
      if (!photoFile && !isEditMode && form.photoUrl) {
        formData.append('photoUrl', form.photoUrl);
      }

      const pet = await submitPet(isEditMode ? petId : null, formData);
      navigate(`/app/pets/${pet._id}`, { replace: true });
    } catch (submitError) {
      setError(submitError?.response?.data?.message || 'Unable to save the pet profile.');
    } finally {
      setSaving(false);
    }
  };

  const previewSrc = photoPreviewUrl || getPetImageSrc(existingPhoto, 'https://placehold.co/600x420/e2e8f0/475569?text=Pet+Preview');

  if (loading) {
    return <div className="glass-panel rounded-3xl p-6 text-sm text-slate-600">Loading pet profile...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="glass-panel rounded-[2rem] border border-white/80 p-6 md:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-violet-600">Pet profile</p>
        <h1 className="font-display mt-3 text-3xl font-bold text-slate-950">
          {isEditMode ? 'Edit pet profile' : 'Create a new pet profile'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Keep the same data flow as the original app, but let MongoDB store the record properly.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="glass-panel rounded-[2rem] border border-white/80 p-6">
          <label className="block text-sm font-semibold text-slate-700">Photo</label>
          <div className="mt-3 overflow-hidden rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-100">
            <img src={previewSrc} alt="Pet preview" className="h-72 w-full object-cover" />
          </div>
          <input type="file" accept="image/*" onChange={handlePhotoChange} className="mt-4 block w-full text-sm text-slate-500" />
          <p className="mt-2 text-xs text-slate-500">Choose a file to see an instant preview before saving.</p>
        </div>

        <div className="glass-panel rounded-[2rem] border border-white/80 p-6">
          <div className="grid gap-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="name">
                Pet name
              </label>
              <input
                id="name"
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                placeholder="Tommy"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="type">
                  Type
                </label>
                <select
                  id="type"
                  name="type"
                  value={form.type}
                  onChange={handleChange}
                  required
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                >
                  <option value="">Select type</option>
                  {PET_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="age">
                  Age
                </label>
                <input
                  id="age"
                  name="age"
                  type="number"
                  min="0"
                  value={form.age}
                  onChange={handleChange}
                  required
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                  placeholder="3"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="breed">
                Breed
              </label>
              <input
                id="breed"
                name="breed"
                value={form.breed}
                onChange={handleChange}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                placeholder="German Shepherd"
              />
            </div>

            {error ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-70"
              >
                {saving ? 'Saving...' : isEditMode ? 'Update pet' : 'Create pet'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/app')}
                className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:border-violet-300 hover:text-violet-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
