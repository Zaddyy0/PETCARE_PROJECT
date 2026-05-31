import { Link } from 'react-router-dom';
import { getPetImageSrc } from '../utils/petImage';

export default function PetCard({ pet }) {
  return (
    <Link
      to={`/app/pets/${pet._id}`}
      className="group glass-panel card-rise block overflow-hidden rounded-3xl border border-white/70"
    >
      <div className="relative h-52 overflow-hidden bg-slate-200">
        <img
          src={getPetImageSrc(pet.photoUrl, 'https://placehold.co/600x420/e2e8f0/475569?text=Pet+Photo')}
          alt={pet.name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/70 to-transparent p-4 text-white">
          <p className="text-xs uppercase tracking-[0.3em] text-white/70">{pet.type}</p>
          <h3 className="font-display text-2xl font-bold">{pet.name}</h3>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <p className="text-sm leading-6 text-slate-600">
          {pet.breed || 'Breed not added yet'} · {pet.age} year{pet.age === 1 ? '' : 's'} old
        </p>
        <div className="flex items-center justify-between text-sm font-semibold text-slate-500">
          <span>View profile</span>
          <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700 transition group-hover:bg-violet-100">Open</span>
        </div>
      </div>
    </Link>
  );
}
