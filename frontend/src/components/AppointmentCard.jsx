import { formatDateTime, getStatusLabel } from '../utils/formatters';
import { getPetImageSrc } from '../utils/petImage';

const statusClassNames = {
  scheduled: 'status-scheduled',
  ongoing: 'status-ongoing',
  completed: 'status-completed'
};

export default function AppointmentCard({ appointment, draggable = false, onDragStart }) {
  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      className="glass-panel card-rise rounded-2xl border border-white/70 p-4"
    >
      <div className="flex items-start gap-3">
        <img
          src={getPetImageSrc(appointment.pet?.photoUrl, 'https://placehold.co/120x120/e2e8f0/475569?text=Pet')}
          alt={appointment.pet?.name || appointment.petName}
          className="h-12 w-12 rounded-2xl object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h4 className="truncate font-display text-base font-bold text-slate-900">
              {appointment.pet?.name || appointment.petName}
            </h4>
            <span className={`status-pill rounded-full px-3 py-1 text-xs font-bold ${statusClassNames[appointment.status]}`}>
              {getStatusLabel(appointment.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{appointment.reason}</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            {formatDateTime(appointment.datetime)}
          </p>
        </div>
      </div>
    </article>
  );
}
